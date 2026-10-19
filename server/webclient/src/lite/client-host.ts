// A shared process owns independent sessions. A logout or failed session ends
// only that account; starting it again is an explicit launcher operation.
import type { SessionEnd } from './session.js';

export function validateSharedClients(members: { host: string; profanityFilter: boolean }[]): void {
    if (new Set(members.map(m => m.host.toLowerCase())).size !== 1 || new Set(members.map(m => m.profanityFilter)).size !== 1) {
        throw new Error('Shared clients require the same SERVER and PROFANITY_FILTER. Use -ClientMode separate for mixed settings.');
    }
}

export interface HostedClient {
    connect(): void;
    stop(): void;
    stopped: Promise<SessionEnd>;
}
export type ClientStatus = 'connecting' | 'active' | 'logged-out' | 'stopped' | 'failed';

// Config registries are process-wide. Never bootstrap/reload them concurrently.
export function serialStarter() {
    let tail: Promise<unknown> = Promise.resolve();
    return <T>(start: () => Promise<T>): Promise<T> => {
        const next = tail.then(start);
        tail = next.catch(() => {});
        return next;
    };
}

export async function hostClient(create: () => Promise<HostedClient>, signal: AbortSignal, status: (state: ClientStatus, error?: unknown) => void): Promise<void> {
    let client: HostedClient | undefined;
    const stop = () => client?.stop();
    signal.addEventListener('abort', stop, { once: true });
    try {
        if (signal.aborted) return;
        status('connecting');
        client = await create();
        if (signal.aborted) {
            client.stop();
            return;
        }
        client.connect();
        status('active');
        const end = await client.stopped;
        status(end.reason === 'logged-out' ? 'logged-out' : end.reason === 'stopped' ? 'stopped' : 'failed', end.error ?? (end.reason === 'disconnected' || end.reason === 'idle' ? end.reason : undefined));
    } catch (error) {
        if (!signal.aborted) status('failed', error);
    } finally {
        signal.removeEventListener('abort', stop);
        client?.stop();
        if (signal.aborted) status('stopped');
    }
}
