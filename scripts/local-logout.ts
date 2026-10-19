import { runScript } from '../sdk/runner';

// Ask the game to log out normally so the engine checkpoints the character.
const result = await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    await sdk.sendSetTab(10);
    await sdk.waitForTicks(1);
    const action = await sdk.sendClickComponent(2458);
    if (!action.success) throw new Error(action.message);
    await Bun.sleep(1800);
}, { onDisconnect: 'ignore', printState: false, timeout: 15000 });
if (!result.success) process.exitCode = 1;
