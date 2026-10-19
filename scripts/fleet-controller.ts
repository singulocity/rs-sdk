import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFleet } from "./fleet-config";
import { superviseBot, type SessionStatus } from "./fleet-runtime";
import {
  installExecutionConsoleCapture,
  formatLogArgument,
} from "../mcp/console-capture";

async function main() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const members = loadFleet(root);
  if (process.argv.includes("--check")) {
    console.log(
      "Validated shared-controller roles and credentials for " +
        members.length +
        " bots.",
    );
    return;
  }
  const [
    { BotSDK },
    { BotActions },
    { initPathfinding },
    { train },
    { trainAdditional },
    { trainWoodcutting },
  ] = await Promise.all([
    import("../sdk/index"),
    import("../sdk/actions"),
    import("../sdk/pathfinding"),
    import("./training"),
    import("./training-more"),
    import("./training-woodcutting"),
  ]);
  initPathfinding();
  const stateDir = join(root, "bots/local-watch");
  const logDir = join(stateDir, "logs");
  mkdirSync(logDir, { recursive: true });
  const statusPath = join(stateDir, "controller-status.json");
  const stopPath = join(stateDir, "controller-stop.json");
  const abort = new AbortController();
  const states: Record<
    string,
    { role: string; state: SessionStatus; updatedAt: string; error?: string }
  > = {};
  const startedAt = new Date().toISOString();
  const print = console.log.bind(console);
  const saveStatus = () => {
    try {
      writeFileSync(
        statusPath + ".tmp",
        JSON.stringify(
          {
            processId: process.pid,
            startedAt,
            updatedAt: new Date().toISOString(),
            bots: states,
          },
          null,
          2,
        ),
      );
      renameSync(statusPath + ".tmp", statusPath);
    } catch {
      /* A transient reader/file lock is retried on the next heartbeat. */
    }
  };
  const shutdown = () => {
    if (!abort.signal.aborted)
      abort.abort(new Error("Fleet controller stopping."));
  };
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  for (const signal of signals) process.on(signal, shutdown);
  const heartbeat = setInterval(() => {
    try {
      if (existsSync(stopPath)) {
        const request = JSON.parse(
          readFileSync(stopPath, "utf8").replace(/^\uFEFF/, ""),
        );
        if (
          request.processId === process.pid &&
          request.startedAt === startedAt
        )
          shutdown();
      }
    } catch {}
    saveStatus();
  }, 500);
  const restoreConsole = installExecutionConsoleCapture();
  const tasks = members.map((member, index) => {
    const key = index === 0 ? "routine" : "routine-" + member.name;
    const safe = (value: unknown) =>
      formatLogArgument(value).split(member.password).join("[REDACTED]");
    const log = (level: "log" | "warn" | "error", args: unknown[]) => {
      const line = args.map(safe).join(" ");
      appendFileSync(
        join(logDir, key + (level === "log" ? ".out.log" : ".err.log")),
        line + "\n",
      );
      print("[" + member.name + "] " + line);
    };
    return superviseBot({
      signal: abort.signal,
      log,
      status(state, error) {
        states[member.name] = {
          role: member.role,
          state,
          updatedAt: new Date().toISOString(),
          ...(error ? { error: safe(error).split("\n")[0] } : {}),
        };
        log(error ? "warn" : "log", [state, ...(error ? [error] : [])]);
        saveStatus();
      },
      create() {
        const sdk = new BotSDK({
          botUsername: member.username,
          password: member.password,
          gatewayUrl: member.gatewayUrl,
          autoLaunchBrowser: false,
          autoReconnect: false,
          showChat: false,
          connectTimeout: 15000,
          readyTimeout: 15000,
        });
        const bot = new BotActions(sdk);
        return {
          async connect() {
            await sdk.connect();
            const tick = sdk.getState()?.tick;
            await sdk.waitForCondition(
              (s) => s.inGame && !!s.player && s.tick !== tick,
              15000,
            );
          },
          async run() {
            const context = { bot, sdk };
            switch (member.role) {
              case "woodcutting":
                return trainWoodcutting(context);
              case "combat":
              case "fishing":
              case "mining":
              case "firemaking":
                return train(member.role, context);
              default:
                return trainAdditional(member.role, context);
            }
          },
          disconnect: () => sdk.disconnect(),
          onDisconnect: (callback) =>
            sdk.onConnectionStateChange((state) => {
              if (state === "disconnected" || state === "reconnecting")
                callback();
            }),
        };
      },
    });
  });
  try {
    await Promise.all(tasks);
  } finally {
    shutdown();
    await Promise.allSettled(tasks);
    clearInterval(heartbeat);
    for (const signal of signals) process.off(signal, shutdown);
    saveStatus();
    restoreConsole();
  }
}

if (import.meta.main)
  main().catch((error) => {
    console.error(formatLogArgument(error));
    process.exitCode = 1;
  });
