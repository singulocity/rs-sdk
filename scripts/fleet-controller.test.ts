import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFleet } from "./fleet-config";
import {
  superviseBot,
  trainingSleep,
  type FleetSession,
} from "./fleet-runtime";
import { executionContext } from "../sdk/execution-context";

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Test condition timed out");
    await Bun.sleep(2);
  }
}

test("one bot can fail and restart while another keeps its own running session", async () => {
  const stop = new AbortController();
  const counts = { healthy: 0, failing: 0, disconnected: 0 };
  const status: Record<string, string> = {};
  const logs: Record<string, string[]> = { healthy: [], failing: [] };
  const task = (name: "healthy" | "failing") =>
    superviseBot({
      signal: stop.signal,
      retryMs: 1,
      status: (state) => {
        status[name] = state;
      },
      log: (_level, args) => logs[name].push(String(args[0])),
      create() {
        const attempt = ++counts[name];
        return {
          async connect() {
            if (name === "failing" && attempt === 1)
              throw new Error("Temporary connection failure");
          },
          async run() {
            executionContext.getStore()!.log!("log", [name]);
            await trainingSleep(60000);
          },
          async disconnect() {
            counts.disconnected++;
          },
          onDisconnect: () => () => {},
        };
      },
    });
  const jobs = [task("healthy"), task("failing")];
  try {
    await until(
      () => status.healthy === "running" && status.failing === "running",
    );
    expect(counts.healthy).toBe(1);
    expect(counts.failing).toBe(2);
    expect(logs.healthy).toEqual(["healthy"]);
    expect(logs.failing).toEqual(["failing"]);
  } finally {
    stop.abort();
    await Promise.all(jobs);
  }
  expect(status).toEqual({ healthy: "stopped", failing: "stopped" });
  expect(counts.disconnected).toBe(3);
});

test("losing a connection cancels its old actions before starting a fresh session", async () => {
  const stop = new AbortController();
  let disconnect!: () => void;
  let starts = 0;
  let cleaned = 0;
  const job = superviseBot({
    signal: stop.signal,
    retryMs: 1,
    status() {},
    create(): FleetSession {
      starts++;
      if (starts > 1) expect(cleaned).toBe(starts - 1);
      return {
        async connect() {},
        async run() {
          try {
            await trainingSleep(60000);
          } finally {
            cleaned++;
          }
        },
        async disconnect() {},
        onDisconnect(callback) {
          disconnect = callback;
          return () => {};
        },
      };
    },
  });
  try {
    await until(() => starts === 1);
    await Bun.sleep(5);
    disconnect();
    await until(() => starts === 2);
  } finally {
    stop.abort();
    await job;
  }
  expect(cleaned).toBe(2);
});

test("fleet config separates credentials without modifying process.env and rejects duplicate names or unsupported roles", () => {
  const root = mkdtempSync(join(tmpdir(), "rs-fleet-config-"));
  const state = join(root, "bots/local-watch");
  mkdirSync(state, { recursive: true });
  writeFileSync(
    join(state, "control-config.json"),
    "\uFEFF" + JSON.stringify({ botName: "Alpha" }),
  );
  const manifest = join(state, "fleet.json");
  writeFileSync(manifest, JSON.stringify([{ name: "Beta", role: "fishing" }]));
  for (const name of ["Alpha", "Beta"]) {
    mkdirSync(join(root, "bots", name));
    writeFileSync(
      join(root, "bots", name, "bot.env"),
      `BOT_USERNAME=${name}\r\nPASSWORD=secret-${name}\r\nGATEWAY_URL=ws://localhost:7780\r\n`,
    );
  }
  const original = process.env.BOT_USERNAME;
  const fleet = loadFleet(root);
  expect(fleet.map((b) => b.username)).toEqual(["Alpha", "Beta"]);
  expect(fleet.map((b) => b.password)).toEqual(["secret-Alpha", "secret-Beta"]);
  expect(process.env.BOT_USERNAME).toBe(original);
  writeFileSync(manifest, JSON.stringify([{ name: "alpha", role: "fishing" }]));
  expect(() => loadFleet(root)).toThrow("Duplicate fleet bot");
  writeFileSync(manifest, JSON.stringify([{ name: "Beta", role: "unknown" }]));
  expect(() => loadFleet(root)).toThrow("Unsupported shared-controller role");
});
