import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bots: { name: string; role: string; module?: string }[] = [
    { name: 'BladeBram', role: 'combat' },
    { name: 'PondPiper', role: 'fishing' },
    { name: 'OreOtis', role: 'mining' },
    { name: 'EmberEtta', role: 'firemaking' },
    { name: 'ChefCora', role: 'cooking', module: 'training-more' },
    { name: 'FletchFinn', role: 'fletching', module: 'training-more' },
    { name: 'WeaverWren', role: 'crafting', module: 'training-more' },
    { name: 'SneakSage', role: 'thieving', module: 'training-more' },
    { name: 'BoneBasil', role: 'prayer', module: 'training-more' },
];
for (const bot of bots) {
    const directory = join(root, 'bots', bot.name);
    const envPath = join(directory, 'bot.env');
    if (!existsSync(envPath)) {
        const result = Bun.spawnSync([process.execPath, 'bots/create-bot.ts', bot.name, '--local', '--no-chat'], {
            cwd: root, stdout: 'inherit', stderr: 'inherit',
        });
        if (result.exitCode !== 0 || !existsSync(envPath)) throw new Error('Cannot create ' + bot.name);
    }
    // Normalize Windows template line endings before adding the explicit local ports.
    let env = readFileSync(envPath, 'utf8').replace(/\r\n/g, '\n');
    env = env.replace(/^SERVER=.*$/m, 'SERVER=localhost:8888')
        .replace(/^GATEWAY_URL=.*\n?/gm, '')
        .replace(/^SHOW_CHAT=.*$/m, 'SHOW_CHAT=false');
    env += '\nGATEWAY_URL=ws://localhost:7780\n';
    writeFileSync(envPath, env);
    const routine = join(directory, 'watch.ts');
    if (!existsSync(routine)) {
        const entry = bot.module ? 'runAdditionalTraining' : 'runTraining';
        writeFileSync(routine, "import { " + entry + " } from '../../scripts/" + (bot.module ?? 'training') + "';\nawait " + entry + "('" + bot.role + "');\n");
    }
}
const stateDir = join(root, 'bots/local-watch');
mkdirSync(stateDir, { recursive: true });
const manifestPath = join(stateDir, 'fleet.json');
const existing: { name: string; role: string }[] = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '')) : [];
for (const bot of bots) {
    if (!existing.some(b => b.name.toLowerCase() === bot.name.toLowerCase())) existing.push(bot);
}
writeFileSync(manifestPath, JSON.stringify(existing, null, 2) + '\n');
console.log('Training fleet configured. Run local.cmd start, status, stop, or help.');
