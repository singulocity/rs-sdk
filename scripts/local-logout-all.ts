import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFleet } from "./fleet-config";
import { logoutWithConfirmation } from "./local-logout";

/** Run `task` over `items` with at most `limit` in flight; never rejects, returns per-item errors. */
export async function runPool<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<{ item: T; error: unknown }[]> {
  const failures: { item: T; error: unknown }[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await task(item);
      } catch (error) {
        failures.push({ item, error });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return failures;
}

async function main() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const members = loadFleet(root);
  const limit = Math.max(
    1,
    Number(process.env.LOGOUT_CONCURRENCY) || 250,
  );
  const [{ BotSDK }, { BotActions }] = await Promise.all([
    import("../sdk/index"),
    import("../sdk/actions"),
  ]);
  const httpBase = "http://127.0.0.1:7780/state/";
  const isDead = async (name: string) => {
    const response = await fetch(httpBase + encodeURIComponent(name), {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      throw new Error("Cannot confirm logout: gateway returned " + response.status);
    }
    return ((await response.json()) as { botStatus?: string }).botStatus === "dead";
  };
  let done = 0;
  const startedAt = Date.now();
  const timings: { name: string; connectMs: number; logoutMs: number }[] = [];
  const failures = await runPool(members, limit, async (member) => {
    try {
      if (await isDead(member.name).catch(() => false)) return;
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
      try {
        const connectStart = Date.now();
        await sdk.connect();
        const connectMs = Date.now() - connectStart;
        const logoutStart = Date.now();
        let tabReady = false;
        await logoutWithConfirmation({
          isLoggedOut: () => isDead(member.name),
          request: async () => {
            if (!tabReady) {
              await bot.dismissBlockingUI();
              await sdk.sendSetTab(10);
              await sdk.waitForTicks(1);
              tabReady = true;
            }
            const action = await sdk.sendClickComponent(2458);
            if (!action.success) throw new Error(action.message);
          },
        });
        timings.push({ name: member.name, connectMs, logoutMs: Date.now() - logoutStart });
      } finally {
        await sdk.disconnect().catch(() => {});
      }
    } finally {
      done++;
      if (done % 25 === 0 || done === members.length) {
        console.log("Logout progress: " + done + "/" + members.length);
      }
    }
  });
  if (timings.length) {
    const slow = [...timings].sort((a, b) => b.connectMs + b.logoutMs - (a.connectMs + a.logoutMs)).slice(0, 3);
    console.log(
      "Total " + Math.round((Date.now() - startedAt) / 1000) + "s; slowest: " +
        slow.map((t) => t.name + " connect " + t.connectMs + "ms, logout " + t.logoutMs + "ms").join("; "),
    );
  }
  if (failures.length) {
    for (const { item, error } of failures) {
      console.error(
        item.name + ": " + (error instanceof Error ? error.message : String(error)),
      );
    }
    throw new Error(
      failures.length + " of " + members.length + " bots could not be confirmed logged out.",
    );
  }
  console.log("Logout confirmed for all " + members.length + " bots.");
}

if (import.meta.main) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
