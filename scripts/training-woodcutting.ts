import type { ScriptContext } from "../sdk/runner";
import { throwIfExecutionAborted } from "../sdk/execution-context";

const route = [
  { x: 3224, z: 3232 },
  { x: 3222, z: 3244 },
  { x: 3230, z: 3240 },
];

export async function trainWoodcutting({ bot, sdk }: ScriptContext) {
  const player = sdk.getState()?.player;
  if (
    player &&
    player.worldX >= 3050 &&
    player.worldX <= 3156 &&
    player.worldZ >= 3056 &&
    player.worldZ <= 3136
  ) {
    for (let attempt = 0; attempt < 6; attempt++) {
      console.log((await bot.skipTutorial()).message);
      await sdk.waitForTicks(2);
      const current = sdk.getState()?.player;
      if (current && current.worldX > 3156) break;
    }
  }

  while (true) {
    throwIfExecutionAborted();
    for (const point of route) {
      const walk = await bot.walkTo(point.x, point.z, 2, { timeout: 20_000 });
      console.log(`Walk to ${point.x},${point.z}: ${walk.message}`);
      for (let chop = 0; chop < 2; chop++) {
        if (sdk.findInventoryItem(/^logs$/i)) {
          console.log((await bot.dropItem(/^logs$/i)).message);
        }
        const tree = sdk.findNearbyLoc(/^tree$/i, { reachable: true });
        if (!tree) break;
        console.log((await bot.chopTree(tree)).message);
      }
      await sdk.waitForTicks(3);
      const state = sdk.getState();
      console.log(
        `Position ${state?.player?.worldX},${state?.player
          ?.worldZ}; woodcutting XP ${sdk.getSkillXp("Woodcutting")}`,
      );
    }
  }
}
