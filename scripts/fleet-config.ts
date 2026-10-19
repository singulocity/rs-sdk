import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const fleetRoles = [
  "woodcutting",
  "combat",
  "fishing",
  "mining",
  "firemaking",
  "cooking",
  "fletching",
  "crafting",
  "thieving",
  "prayer",
] as const;
export type FleetRole = (typeof fleetRoles)[number];
export type FleetMember = {
  name: string;
  role: FleetRole;
  username: string;
  password: string;
  gatewayUrl: string;
};

const readJson = (path: string) =>
  JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
export function parseBotEnv(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq > 0) result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return result;
}

export function loadFleet(root: string): FleetMember[] {
  const stateDir = join(root, "bots/local-watch");
  const control = readJson(join(stateDir, "control-config.json"));
  const manifest = join(stateDir, "fleet.json");
  const entries = [
    { name: control.botName, role: control.primaryRole ?? "woodcutting" },
    ...(existsSync(manifest) ? readJson(manifest) : []),
  ];
  const seen = new Set<string>();
  return entries.map((entry) => {
    if (
      typeof entry.name !== "string" ||
      !/^[a-zA-Z0-9]{1,12}$/.test(entry.name)
    )
      throw new Error("Invalid fleet bot name.");
    if (seen.has(entry.name.toLowerCase()))
      throw new Error("Duplicate fleet bot: " + entry.name);
    seen.add(entry.name.toLowerCase());
    if (!fleetRoles.includes(entry.role))
      throw new Error(
        "Unsupported shared-controller role for " +
          entry.name +
          ": " +
          entry.role,
      );
    const env = parseBotEnv(
      readFileSync(join(root, "bots", entry.name, "bot.env"), "utf8"),
    );
    if (
      !env.PASSWORD ||
      env.BOT_USERNAME?.toLowerCase() !== entry.name.toLowerCase()
    )
      throw new Error("Missing or mismatched credentials for " + entry.name);
    const gatewayUrl = env.GATEWAY_URL || "ws://localhost:7780";
    if (!["ws:", "wss:"].includes(new URL(gatewayUrl).protocol))
      throw new Error("Invalid gateway URL for " + entry.name);
    return {
      name: entry.name,
      role: entry.role as FleetRole,
      username: env.BOT_USERNAME,
      password: env.PASSWORD,
      gatewayUrl,
    };
  });
}
