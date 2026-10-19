import { runScript, type ScriptContext } from '../sdk/runner';

export type TrainingRole = 'combat' | 'fishing' | 'mining' | 'firemaking';
const homes = {
    combat: { x: 3237, z: 3295 },
    fishing: { x: 3087, z: 3228 },
    mining: { x: 3285, z: 3365 },
    firemaking: { x: 3200, z: 3240 },
};
const skills: Record<TrainingRole, string[]> = {
    combat: ['Attack', 'Strength', 'Defence', 'Hitpoints'],
    fishing: ['Fishing'], mining: ['Mining'], firemaking: ['Firemaking', 'Woodcutting'],
};

export async function runTraining(role: TrainingRole) {
    const result = await runScript(async ({ bot, sdk }: ScriptContext) => {
        for (let attempt = 0; attempt < 8; attempt++) {
            const p = sdk.getState()?.player;
            if (!p) throw new Error('No player state');
            const tutorial = p.worldX >= 3050 && p.worldX <= 3156 &&
                p.worldZ >= 3056 && p.worldZ <= 3136;
            if (!tutorial) break;
            console.log((await bot.skipTutorial()).message);
            await sdk.waitForTicks(2);
            if (attempt === 7) throw new Error('Tutorial not completed');
        }
        const home = homes[role];
        if (role === 'combat') {
            const sword = sdk.findInventoryItem(/bronze.*sword/i);
            if (sword) console.log((await bot.equipItem(sword)).message);
            const style = sdk.getState()?.combatStyle?.styles.find(s => s.trainsSkills.includes('Attack'));
            if (style) await sdk.sendSetCombatStyle(style.index);
        }
        let lastReport = 0;
        let failures = 0;
        while (true) {
            try {
                await bot.dismissBlockingUI();
                const state = sdk.getState();
                const p = state?.player;
                if (!p || !state) throw new Error('No live player state');
                if (p.hp <= Math.max(3, Math.floor(p.maxHp * 0.4))) {
                    const food = state.inventory.find(i =>
                        i.optionsWithIndex?.some(o => /^eat$/i.test(o.text)));
                    if (food) console.log((await bot.eatFood(food)).message);
                    else if (role === 'combat' || p.combat.inCombat) {
                        // Avoid more combat at low HP. Safe gathering can continue while healing.
                        console.log('Low HP; resting before continuing.');
                        await Bun.sleep(5000);
                        continue;
                    }
                }
                const drift = Math.hypot(p.worldX - home.x, p.worldZ - home.z);
                if (drift > (role === 'fishing' ? 8 : 18)) {
                    const walk = await bot.walkTo(home.x, home.z, 2, { timeout: 45000 });
                    console.log(walk.message);
                    if (!walk.success) { await Bun.sleep(2000); continue; }
                }
                if (Date.now() - lastReport > 15000) {
                    console.log(JSON.stringify({
                        role, position: [p.worldX, p.worldZ], hp: p.hp,
                        xp: Object.fromEntries(skills[role].map(s => [s, sdk.getSkillXp(s)])),
                    }));
                    lastReport = Date.now();
                }
                if (role === 'combat') {
                    if (!sdk.getState()?.player?.combat.inCombat) {
                        const chicken = sdk.getState()?.nearbyNpcs
                            .filter(n => /^chicken$/i.test(n.name) && n.hp !== 0 && !n.inCombat)
                            .sort((a,b) => a.distance - b.distance)[0];
                        if (chicken) console.log((await bot.attack(chicken)).message);
                        else await bot.walkTo(home.x, home.z, 2, { timeout: 20000 });
                    }
                    await Bun.sleep(1000);
                } else if (role === 'fishing') {
                    if (sdk.getInventory().length >= 27) {
                        await bot.dropItem(/^raw (shrimps|anchovies)$/i);
                    }
                    const spot = sdk.getState()?.nearbyNpcs.filter(n =>
                        /fishing\s*spot/i.test(n.name) &&
                        n.optionsWithIndex.some(o => /^bait$/i.test(o.text)) &&
                        n.optionsWithIndex.some(o => /^net$/i.test(o.text)) &&
                        (n.tileZ ?? n.z) <= 3231
                    ).sort((a,b) => a.distance - b.distance)[0];
                    if (spot) {
                        const xp = sdk.getSkillXp('Fishing') ?? 0;
                        const action = await bot.interactNpc(spot, /^net$/i);
                        if (!action.success) console.log(action.message);
                        await sdk.waitForCondition(s => s.skills.some(k =>
                            k.name === 'Fishing' && k.experience > xp) || s.dialog.isOpen, 15000).catch(() => {});
                    } else {
                        console.log('Looking for a small-net fishing spot.');
                        await bot.walkTo(home.x, home.z, 1, { timeout: 20000 });
                        await Bun.sleep(2000);
                    }
                } else if (role === 'mining') {
                    if (sdk.getInventory().length >= 27) {
                        await bot.dropItem(/^(copper|tin) ore$/i);
                    }
                    const rock = sdk.findNearbyLoc(/rocks.*(copper|tin) ore/i, { reachable: true });
                    if (rock) console.log((await bot.mineRock(rock, { timeout: 15000 })).message);
                    else { await bot.walkTo(home.x, home.z, 2); await Bun.sleep(2000); }
                } else {
                    const logs = sdk.findInventoryItem(/^logs$/i);
                    if (logs) {
                        const action = await bot.burnLogs(logs);
                        console.log(action.message);
                        if (!action.success) {
                            await bot.walkTo(home.x + Math.floor(Math.random()*7)-3,
                                home.z + Math.floor(Math.random()*5)-2, 0, { timeout: 15000 });
                        }
                    } else {
                        const tree = sdk.findNearbyLoc(/^tree$/i, { reachable: true });
                        if (tree) console.log((await bot.chopTree(tree)).message);
                        else await bot.walkTo(home.x, home.z, 2);
                    }
                }
                failures = 0;
                await Bun.sleep(250);
            } catch (error) {
                failures++;
                console.error('Training retry:', String(error));
                if (failures >= 5 || sdk.getStateAge() > 15000) throw error;
                await Bun.sleep(2000);
            }
        }
    }, { printState: false });
    if (!result.success) process.exitCode = 1;
}
