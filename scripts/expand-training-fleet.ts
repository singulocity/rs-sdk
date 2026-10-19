import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fleetRoles, loadFleet, type FleetRole } from "./fleet-config";

type Assignment = { name: string; role: FleetRole };
const handles = [
  "VantaByte",
  "rxven7",
  "NullSignal",
  "midnightPC",
  "lowkeyEcho",
  "z3roPing",
  "NyxOnline",
  "ArcadeGhost",
  "cobalt404",
  "xNocturne",
  "SleepyPixel",
  "VelvetStatic",
  "m0onphase",
  "PaperOrbit",
  "fadedJPEG",
  "ghostTab",
  "afterglow8",
  "hexadecimal",
  "BlueScreen9",
  "lastLobby",
  "DuskMode",
  "offlineKai",
  "neonMoth",
  "tinyGlitch",
  "ObsidianX",
  "pixelDrift",
  "lunarNoise",
  "justMilo",
  "fr0stbyte",
  "EchoViolet",
  "NoReply42",
  "violet.exe",
  "sodaSatellite",
  "lazyOrbit",
  "BitterMint",
  "ashnova",
  "k1teRunner",
  "ChromeLily",
  "NightCache",
  "softReset",
  "almostAFK",
  "CosmicMoss",
  "RainCheck7",
  "MangoPacket",
  "novaArchive",
  "quietlyZen",
  "StaticBloom",
  "driftAway",
  "junoLag",
  "xLiminal",
  "smallComet",
  "citrusHex",
  "MauveMoon",
  "eightBitAmy",
  "idleTheory",
  "forgotMyAlt",
  "lucidNoodle",
  "vhsDreams",
  "tangerine9",
  "EchoReverb",
  "RookOnline",
  "aquaShift",
  "theLastTab",
  "hazel404",
  "retroQuasar",
  "mildChaos",
  "plutoSleep",
  "SolarFuzz",
  "misoPacket",
  "cyanAfter",
  "caffein8d",
  "ZeroGravity",
  "berryOffline",
  "KoiCircuit",
  "lagSpikes",
  "MothInSpace",
  "hushSignal",
  "virtualFern",
  "lilNebula",
  "GreyCassette",
  "lofiLemon",
  "MapleNoise",
  "sparePixel",
  "WintersAlt",
  "sleeplessAJ",
  "FuzzyLogic",
  "nearMidnight",
  "copperSky",
  "OrbitingSam",
  "almostLegend",
].map((name) => name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12));

// Preserve every existing account. Reserved names include local bot folders,
// so expansion never takes over another account or overwrites its credentials.
export function planExpansion(
  existing: Assignment[],
  reserved: string[] = [],
  perRole = 10,
): Assignment[] {
  if (!Number.isInteger(perRole) || perRole < 1 || perRole > 10)
    throw new Error("per-role must be an integer from 1 to 10.");
  const counts = Object.fromEntries(
    fleetRoles.map((role) => [role, 0]),
  ) as Record<FleetRole, number>;
  const used = new Set(reserved.map((name) => name.toLowerCase()));
  const assigned = new Set<string>();
  for (const bot of existing) {
    if (!fleetRoles.includes(bot.role) || assigned.has(bot.name.toLowerCase()))
      throw new Error("Invalid or duplicate fleet assignment.");
    assigned.add(bot.name.toLowerCase());
    used.add(bot.name.toLowerCase());
    counts[bot.role]++;
  }
  if (fleetRoles.some((role) => counts[role] > perRole))
    throw new Error(
      "A role already exceeds the requested total; existing accounts will not be removed.",
    );
  let cursor = 0;
  const nextName = () => {
    for (;;) {
      const base = handles[cursor % handles.length];
      const round = Math.floor(cursor++ / handles.length);
      const suffix = round ? String(round) : "";
      const name = base.slice(0, 12 - suffix.length) + suffix;
      if (!used.has(name.toLowerCase())) {
        used.add(name.toLowerCase());
        return name;
      }
    }
  };
  const additions: Assignment[] = [];
  for (let round = 0; round < perRole; round++) {
    for (const role of fleetRoles) {
      if (counts[role] >= perRole) continue;
      additions.push({ name: nextName(), role });
      counts[role]++;
    }
  }
  return additions;
}

async function main() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--dry-run" && !arg.startsWith("--per-role=")))
    throw new Error(
      "Usage: bun scripts/expand-training-fleet.ts [--per-role=10] [--dry-run]",
    );
  const perRole = Number(
    args.find((arg) => arg.startsWith("--per-role="))?.split("=")[1] ?? 10,
  );
  const current = loadFleet(root);
  const additions = planExpansion(
    current,
    readdirSync(join(root, "bots")),
    perRole,
  );
  if (args.includes("--dry-run")) {
    console.table(additions);
    console.log(
      additions.length +
        " additions; " +
        (current.length + additions.length) +
        " total accounts.",
    );
    return;
  }
  const manifestPath = join(root, "bots/local-watch/fleet.json");
  const manifest: Assignment[] = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""))
    : [];
  for (const bot of additions) {
    const directory = join(root, "bots", bot.name);
    const envPath = join(directory, "bot.env");
    const result = Bun.spawnSync(
      [
        process.execPath,
        "bots/create-bot.ts",
        bot.name,
        "--local",
        "--no-chat",
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe", windowsHide: true },
    );
    if (result.exitCode !== 0 || !existsSync(envPath))
      throw new Error(
        "Could not create " + bot.name + "; existing accounts were preserved.",
      );
    let env = readFileSync(envPath, "utf8").replace(/\r\n/g, "\n");
    env = env
      .replace(/^SERVER=.*$/m, "SERVER=localhost:8888")
      .replace(/^GATEWAY_URL=.*\n?/gm, "")
      .replace(/^SHOW_CHAT=.*$/m, "SHOW_CHAT=false");
    writeFileSync(envPath, env + "\nGATEWAY_URL=ws://localhost:7780\n");
    let routine: string;
    if (bot.role === "woodcutting") {
      routine =
        "import { runScript } from '../../sdk/runner';\nimport { trainWoodcutting } from '../../scripts/training-woodcutting';\nconst result = await runScript(trainWoodcutting, { printState: false });\nif (!result.success) process.exitCode = 1;\n";
    } else {
      const basic = ["combat", "fishing", "mining", "firemaking"].includes(
        bot.role,
      );
      const entry = basic ? "runTraining" : "runAdditionalTraining";
      const module = basic ? "training" : "training-more";
      routine =
        "import { " +
        entry +
        " } from '../../scripts/" +
        module +
        "';\nawait " +
        entry +
        "('" +
        bot.role +
        "');\n";
    }
    writeFileSync(join(directory, "watch.ts"), routine);
    manifest.push(bot);
    writeFileSync(
      manifestPath + ".tmp",
      JSON.stringify(manifest, null, 2) + "\n",
    );
    renameSync(manifestPath + ".tmp", manifestPath);
    console.log("Created " + bot.name + " (" + bot.role + ")");
  }
  const fleet = loadFleet(root);
  console.table(
    fleetRoles.map((role) => ({
      role,
      bots: fleet.filter((bot) => bot.role === role).length,
    })),
  );
  console.log(
    fleet.length + " accounts configured. Start with local.cmd start.",
  );
}
if (import.meta.main)
  await main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
