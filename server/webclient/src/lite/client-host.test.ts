import { expect, test } from 'bun:test';
import { hostClient, serialStarter, validateSharedClients, type ClientStatus, type HostedClient } from './client-host.js';
import type { SessionEnd } from './session.js';

function fake() {
    let finish!: (end: SessionEnd) => void;
    let connects = 0,
        stops = 0;
    const stopped = new Promise<SessionEnd>(resolve => {
        finish = resolve;
    });
    const client: HostedClient = {
        connect() {
            connects++;
        },
        stop() {
            stops++;
            finish({ reason: 'stopped' });
        },
        stopped
    };
    return {
        client,
        finish,
        get connects() {
            return connects;
        },
        get stops() {
            return stops;
        }
    };
}
async function until(check: () => boolean) {
    for (let i = 0; i < 100; i++) {
        if (check()) return;
        await Bun.sleep(2);
    }
    throw new Error('Condition timed out');
}
test('logging out one hosted account leaves the other connected and never logs it back in', async () => {
    const abort = new AbortController();
    const a = fake(),
        b = fake();
    let startsA = 0,
        startsB = 0;
    const states: Record<string, ClientStatus> = {};
    const jobs = [
        hostClient(
            async () => {
                startsA++;
                return a.client;
            },
            abort.signal,
            s => {
                states.a = s;
            }
        ),
        hostClient(
            async () => {
                startsB++;
                return b.client;
            },
            abort.signal,
            s => {
                states.b = s;
            }
        )
    ];
    await until(() => states.a === 'active' && states.b === 'active');
    a.finish({ reason: 'logged-out' });
    await jobs[0];
    expect(states.a).toBe('logged-out');
    expect(states.b).toBe('active');
    expect(b.stops).toBe(0);
    await Bun.sleep(10);
    expect(startsA).toBe(1);
    expect(startsB).toBe(1);
    abort.abort();
    await jobs[1];
    expect(states.b).toBe('stopped');
});
test('failed login does not stop healthy accounts and a late login is closed on shutdown', async () => {
    const abort = new AbortController();
    let finish!: (client: HostedClient) => void;
    const late = fake();
    const states: Record<string, ClientStatus> = {};
    const pending = hostClient(
        () =>
            new Promise(resolve => {
                finish = resolve;
            }),
        abort.signal,
        s => {
            states.late = s;
        }
    );
    await hostClient(
        async () => {
            throw new Error('login refused');
        },
        abort.signal,
        s => {
            states.failed = s;
        }
    );
    expect(states.failed).toBe('failed');
    expect(states.late).toBe('connecting');
    abort.abort();
    finish(late.client);
    await pending;
    expect(late.connects).toBe(0);
    expect(late.stops).toBeGreaterThan(0);
    expect(states.late).toBe('stopped');
});
test('serial bootstrap prevents overlapping registry initialization and recovers after a failure', async () => {
    const serial = serialStarter();
    let initializing = 0;
    const order: number[] = [];
    const results = await Promise.allSettled(
        [1, 2, 3].map(n =>
            serial(async () => {
                expect(++initializing).toBe(1);
                await Bun.sleep(2);
                initializing--;
                order.push(n);
                if (n === 2) throw new Error('failed');
                return n;
            })
        )
    );
    expect(order).toEqual([1, 2, 3]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
});

test('shared hosts reject incompatible worlds or process-wide chat settings', () => {
    const a = { host: 'localhost:8888', profanityFilter: true };
    expect(() => validateSharedClients([a, { ...a }])).not.toThrow();
    expect(() => validateSharedClients([a, { ...a, host: 'localhost:8889' }])).toThrow('SERVER');
    expect(() => validateSharedClients([a, { ...a, profanityFilter: false }])).toThrow('PROFANITY_FILTER');
});
