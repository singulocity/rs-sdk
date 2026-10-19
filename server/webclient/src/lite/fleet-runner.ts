// Run the configured local fleet's game sessions in one Bun process.
// Start from server/webclient so the #/* import map resolves.
import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFleet } from '../../../../scripts/fleet-config';
import { hostClient, validateSharedClients, type ClientStatus } from './client-host.js';

async function main() {
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    const members = loadFleet(root);
    // Static config and WordFilter cannot represent different worlds/settings.
    validateSharedClients(members);
    if (process.argv.includes('--check')) {
        console.log('Validated shared-client settings for ' + members.length + ' bots.');
        return;
    }
    const [{ startSession }, { LiteGatewayRunner }, { FAST_KBD_RUNTIME_MODE }] = await Promise.all([import('./session.js'), import('./runner.js'), import('./fast-kbd.js')]);
    const runtimeMode = await Bun.file(join(root, 'bots/logs/fleet-runtime.mode'))
        .text()
        .then(s => s.trim())
        .catch(() => '');
    const stateDir = join(root, 'bots/local-watch');
    mkdirSync(stateDir, { recursive: true });
    const states: Record<string, { state: ClientStatus; updatedAt: string; error?: string }> = {};
    const startedAt = new Date().toISOString();
    const save = () => {
        try {
            const file = join(stateDir, 'clients-status.json');
            writeFileSync(file + '.tmp', JSON.stringify({ processId: process.pid, startedAt, updatedAt: new Date().toISOString(), bots: states }));
            renameSync(file + '.tmp', file);
        } catch {} // Readers can briefly lock this file on Windows.
    };
    const abort = new AbortController();
    const shutdown = () => abort.abort();
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    // Registries (cache, LocIndex, WordFilter) are process-wide and memoized: the first bot warms
    // them alone, then every other bot starts and logs in concurrently.
    let warmed: Promise<unknown> | undefined;
    const heartbeat = setInterval(save, 500);
    try {
        await Promise.all(
            members.map(member =>
                hostClient(
                    async () => {
                        const start = async () => {
                            if (abort.signal.aborted) throw new Error('Client host stopping.');
                            const session = await startSession({ host: member.host, username: member.username, password: member.password, profanityFilter: member.profanityFilter, quiet: true });
                            try {
                                const runner = new LiteGatewayRunner(session, member.gatewayUrl, runtimeMode === FAST_KBD_RUNTIME_MODE);
                                return { connect: () => runner.connect(), stop: () => runner.stop(), stopped: session.stopped };
                            } catch (error) {
                                session.stop();
                                throw error;
                            }
                        };
                        if (!warmed) {
                            const first = start();
                            warmed = first.catch(() => {});
                            return first;
                        }
                        await warmed;
                        return start();
                    },
                    abort.signal,
                    (state, error) => {
                        const safeError = error === undefined ? undefined : String(error).split(member.password).join('[REDACTED]').slice(0, 1000);
                        states[member.name] = { state, updatedAt: new Date().toISOString(), ...(safeError ? { error: safeError } : {}) };
                        console.log('[' + member.name + '] ' + state + (safeError ? ': ' + safeError : ''));
                        save();
                    }
                )
            )
        );
    } finally {
        clearInterval(heartbeat);
        process.off('SIGINT', shutdown);
        process.off('SIGTERM', shutdown);
        save();
    }
    if (Object.values(states).some(s => s.state === 'failed')) process.exitCode = 1;
}
await main().catch(error => {
    console.error('[client-host]', error.message);
    process.exitCode = 1;
});
