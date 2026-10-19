import { runScript, type ScriptContext } from "../sdk/runner";

export type AdditionalTrainingRole =
  | "cooking"
  | "fletching"
  | "crafting"
  | "thieving"
  | "prayer";
const mainSkill: Record<AdditionalTrainingRole, string> = {
  cooking: "Cooking",
  fletching: "Fletching",
  crafting: "Crafting",
  thieving: "Thieving",
  prayer: "Prayer",
};

import { trainingSleep } from "./fleet-runtime";
import { throwIfExecutionAborted } from "../sdk/execution-context";

export async function trainAdditional(
  role: AdditionalTrainingRole,
  { bot, sdk }: ScriptContext,
) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const p = sdk.getState()?.player;
    if (!p) throw new Error("No player state");
    if (
      !(
        p.worldX >= 3050 &&
        p.worldX <= 3156 &&
        p.worldZ >= 3056 &&
        p.worldZ <= 3136
      )
    )
      break;
    console.log((await bot.skipTutorial()).message);
    await sdk.waitForTicks(2);
    if (attempt === 7) throw new Error("Tutorial not completed");
  }
  const skill = mainSkill[role];
  let cookingPhase: "fish" | "cook" =
    sdk.getState()!.player!.worldZ >= 3245 &&
    sdk.getInventory().some((i) => /^raw (shrimps|anchovies)$/i.test(i.name))
      ? "cook"
      : "fish";
  let lastReport = 0;
  let failures = 0;
  const inventory = (pattern: RegExp) =>
    sdk.getInventory().filter((i) => pattern.test(i.name));
  const go = async (x: number, z: number, tolerance = 2) => {
    const p = sdk.getState()?.player;
    if (p && Math.hypot(p.worldX - x, p.worldZ - z) <= tolerance) return;
    const action = await bot.walkTo(x, z, tolerance, { timeout: 45000 });
    if (!action.success) throw new Error(action.message);
  };
  const waitXp = async (
    before: number,
    timeout = 12000,
    completed?: () => boolean,
  ) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if ((sdk.getSkillXp(skill) ?? 0) > before) return true;
      if (completed?.()) return false;
      const dialog = sdk.getState()?.dialog;
      if (dialog?.isOpen) {
        const product = dialog.options.find((o) =>
          (role === "cooking" ? /shrimps|anchovies/i : /^wool$/i).test(o.text),
        );
        if (product) await sdk.sendClickDialog(product.index);
        else if (dialog.options.length <= 1) await bot.dismissBlockingUI();
      }
      await trainingSleep(500);
    }
    return false;
  };
  const pickpocket = async () => {
    await go(3222, 3218, 3);
    const man = sdk.findNearbyNpc(/^man$/i, { reachable: true });
    if (!man) {
      await trainingSleep(2000);
      return;
    }
    const action = await bot.pickpocketNpc(man);
    console.log(action.message);
    if (action.reason === "stunned") await trainingSleep(5000);
  };
  const useStairs = async (direction: "up" | "down") => {
    await go(3205, 3208, 2);
    const before = sdk.getState()!.player!.level;
    const option = direction === "up" ? /climb.up/i : /climb.down/i;
    const stairs = sdk
      .getNearbyLocs()
      .filter(
        (l) =>
          /staircase|stairs/i.test(l.name) &&
          l.optionsWithIndex.some((o) => option.test(o.text)),
      )
      .sort((a, b) => a.distance - b.distance)[0];
    if (!stairs) throw new Error("No castle stairs for " + direction);
    const action = await bot.interactLoc(stairs, option);
    if (!action.success) console.log(action.message);
    await sdk.waitForCondition(
      (s) => s.player?.level === before + (direction === "up" ? 1 : -1),
      10000,
    );
  };

  const openAccessDoor = async (target: {
    x: number;
    z: number;
    reachable?: boolean;
  }) => {
    if (target.reachable !== false) return;
    const doors = sdk
      .getNearbyLocs()
      .filter(
        (l) =>
          /^door$/i.test(l.name) &&
          l.optionsWithIndex.some((o) => /^open$/i.test(o.text)) &&
          l.distance <= 10 &&
          Math.hypot(l.x - target.x, l.z - target.z) <= 10,
      );
    doors.sort(
      (a, b) =>
        a.distance +
        Math.hypot(a.x - target.x, a.z - target.z) -
        (b.distance + Math.hypot(b.x - target.x, b.z - target.z)),
    );
    if (doors[0]) console.log((await bot.openDoor(doors[0])).message);
  };

  const step = async () => {
    if (role === "thieving") {
      await pickpocket();
      return;
    }
    if (role === "fletching") {
      if (!inventory(/^knife$/i).length) {
        await go(3224, 3202, 1);
        const knife = (await sdk.scanGroundItems()).find((i) =>
          /^knife$/i.test(i.name),
        );
        if (knife) console.log((await bot.pickupItem(knife)).message);
        else {
          console.log("Waiting for the knife spawn.");
          await trainingSleep(2500);
        }
        return;
      }
      await go(3215, 3238, 8);
      if (inventory(/^logs$/i).length) {
        console.log((await bot.fletchLogs("Arrow shafts")).message);
      } else {
        const tree = sdk.findNearbyLoc(/^tree$/i, { reachable: true });
        if (tree) console.log((await bot.chopTree(tree)).message);
        else await trainingSleep(2000);
      }
      return;
    }
    if (role === "prayer") {
      const bone = inventory(/^bones$/i)[0];
      if (bone) {
        const xp = sdk.getSkillXp(skill) ?? 0;
        const option = bone.optionsWithIndex.find((o) =>
          /^bury$/i.test(o.text),
        );
        const action = await sdk.sendUseItem(bone.slot, option?.opIndex ?? 1);
        if (!action.success) throw new Error(action.message);
        await waitXp(xp, 6000);
        return;
      }
      await go(3237, 3295, 8);
      const bones = (await sdk.scanGroundItems())
        .filter((i) => /^bones$/i.test(i.name) && i.reachable !== false)
        .sort((a, b) => a.distance - b.distance)[0];
      if (bones) {
        console.log((await bot.pickupItem(bones)).message);
        return;
      }
      if (!sdk.getState()?.player?.combat.inCombat) {
        const chicken = sdk
          .getState()
          ?.nearbyNpcs.filter(
            (n) => /^chicken$/i.test(n.name) && n.hp !== 0 && !n.inCombat,
          )
          .sort((a, b) => a.distance - b.distance)[0];
        if (chicken) console.log((await bot.attack(chicken)).message);
      }
      await trainingSleep(1500);
      return;
    }
    if (role === "cooking") {
      // Recover the net if it was lost between sessions (for example, on death).
      if (!inventory(/^small fishing net$/i).length) {
        const coins = inventory(/^coins$/i).reduce(
          (total, item) => total + item.count,
          0,
        );
        if (coins < 5) {
          if (sdk.getState()!.player!.hp <= 4) await trainingSleep(5000);
          else await pickpocket();
          return;
        }
        await go(3014, 3224, 3);
        const shop = await bot.openShop(/^gerrant$/i);
        if (!shop.success) throw new Error(shop.message);
        try {
          const purchase = await bot.buyFromShop(/^small fishing net$/i, 1);
          if (!purchase.success) throw new Error(purchase.message);
        } finally {
          await bot.closeShop();
        }
        if (!inventory(/^small fishing net$/i).length)
          throw new Error("Replacement net not received yet.");
        return;
      }
      const raw = inventory(/^raw (shrimps|anchovies)$/i);
      if (raw.length >= 5 || sdk.getInventory().length >= 26)
        cookingPhase = "cook";
      if (raw.length === 0) cookingPhase = "fish";
      if (cookingPhase === "fish") {
        const p = sdk.getState()!.player!;
        // Approach the net spots from the east, south of the dark wizards.
        if (
          p.worldX > 3095 &&
          Math.hypot(p.worldX - 3087, p.worldZ - 3228) > 12
        )
          await go(3107, 3228, 2);
        await go(3087, 3228, 2);
        const spot = sdk
          .getState()
          ?.nearbyNpcs.filter(
            (n) =>
              /fishing\s*spot/i.test(n.name) &&
              n.optionsWithIndex.some((o) => /^net$/i.test(o.text)) &&
              n.optionsWithIndex.some((o) => /^bait$/i.test(o.text)) &&
              (n.tileZ ?? n.z) <= 3231,
          )
          .sort((a, b) => a.distance - b.distance)[0];
        if (spot) {
          const count = raw.length;
          console.log((await bot.interactNpc(spot, /^net$/i)).message);
          await sdk
            .waitForCondition(
              (s) =>
                s.inventory.filter((i) =>
                  /^raw (shrimps|anchovies)$/i.test(i.name),
                ).length > count || s.dialog.isOpen,
              15000,
            )
            .catch(() => {});
        } else await trainingSleep(2000);
      } else {
        if (sdk.getState()!.player!.worldZ < 3245) await go(3107, 3228, 2);
        await go(3107, 3255, 10);
        const source = sdk.findNearbyLoc(
          /^(fireplace|range|fire|cooking pot)$/i,
        );
        if (!source)
          throw new Error("No cooking source near Draynor fireplace");
        const xp = sdk.getSkillXp(skill) ?? 0;
        await openAccessDoor(source);
        console.log((await bot.useItemOnLoc(raw[0], source)).message);
        // Burnt fish consumes the raw item without awarding XP.
        await waitXp(
          xp,
          12000,
          () => inventory(/^raw (shrimps|anchovies)$/i).length < raw.length,
        );
        if (sdk.getInventory().length >= 25) {
          await bot.dropItem(/^burnt (shrimps|anchovies|fish)$/i);
          const cooked = inventory(/^(shrimps|anchovies)$/i);
          if (cooked.length > 3)
            await bot.dropItem(cooked[cooked.length - 1], 1);
        }
      }
      return;
    }

    // Crafting: shear sheep, then spin small batches of wool upstairs.
    const p = sdk.getState()!.player!;
    if (!inventory(/^shears$/i).length) {
      if (p.level > 0) {
        await useStairs("down");
        return;
      }
      const coins = inventory(/^coins$/i).reduce((n, i) => n + i.count, 0);
      if (coins < 2) {
        await pickpocket();
        return;
      }
      await go(3210, 3244, 3);
      console.log((await bot.openShop(/shop\s*keeper/i)).message);
      const action = await bot.buyFromShop(/^shears$/i, 1);
      await bot.closeShop();
      if (!action.success) throw new Error(action.message);
      return;
    }
    const wool = inventory(/^wool$/i);
    if (p.level > 0) {
      if (!wool.length) {
        await useStairs("down");
        return;
      }
      if (p.level > 1) {
        await useStairs("down");
        return;
      }
      const wheel = (await sdk.scanNearbyLocs(24)).find((l) =>
        /^spinning wheel$/i.test(l.name),
      );
      if (!wheel)
        throw new Error("No spinning wheel visible on castle first floor");
      await openAccessDoor(wheel);
      const xp = sdk.getSkillXp(skill) ?? 0;
      console.log((await bot.useItemOnLoc(wool[0], wheel)).message);
      await waitXp(xp);
      return;
    }
    if (
      wool.length >= 5 ||
      (wool.length > 0 && sdk.getInventory().length >= 26)
    ) {
      await useStairs("up");
      return;
    }
    if (
      sdk.getInventory().length >= 25 &&
      inventory(/^ball of wool$/i).length
    ) {
      await bot.dropItem(/^ball of wool$/i);
    }
    await go(3197, 3273, 5);
    const sheep = sdk
      .getState()
      ?.nearbyNpcs.filter((n) => n.id === 43)
      .sort((a, b) => a.distance - b.distance)[0];
    const shears = inventory(/^shears$/i)[0];
    if (sheep) console.log((await bot.useItemOnNpc(shears, sheep)).message);
    else await trainingSleep(2500);
  };

  while (true) {
    throwIfExecutionAborted();
    try {
      await bot.dismissBlockingUI();
      const p = sdk.getState()?.player;
      if (!p) throw new Error("No live player state");
      if (p.hp <= 4) {
        const food = sdk
          .getInventory()
          .find((i) => i.optionsWithIndex.some((o) => /^eat$/i.test(o.text)));
        if (food) console.log((await bot.eatFood(food)).message);
        else if (role === "thieving" || p.combat.inCombat) {
          console.log("Low HP; resting until safe to continue.");
          await trainingSleep(5000);
          continue;
        }
      }
      if (Date.now() - lastReport > 15000) {
        console.log(
          JSON.stringify({
            role,
            position: [p.worldX, p.worldZ, p.level],
            hp: p.hp,
            skill,
            xp: sdk.getSkillXp(skill),
          }),
        );
        lastReport = Date.now();
      }
      await step();
      failures = 0;
      await trainingSleep(1000);
    } catch (error) {
      throwIfExecutionAborted();
      failures++;
      console.error("Training retry:", String(error));
      if (failures >= 8 || sdk.getStateAge() > 15000) throw error;
      await trainingSleep(2500);
    }
  }
}

export async function runAdditionalTraining(role: AdditionalTrainingRole) {
  const result = await runScript((context) => trainAdditional(role, context), {
    printState: false,
  });
  if (!result.success) process.exitCode = 1;
}
