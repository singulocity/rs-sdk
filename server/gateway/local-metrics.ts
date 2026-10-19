import { fileURLToPath } from 'node:url';

export interface MemorySnapshot {
    sampledAt: string;
    processes: { service: string; botName?: string | null; pid: number; workingSetBytes: number; privateBytes: number }[];
    totals: { processCount: number; workingSetBytes: number; privateBytes: number };
    host: { totalBytes: number; availableBytes: number };
}

async function collectWindowsMemory(): Promise<MemorySnapshot> {
    if (process.platform !== 'win32') throw new Error('Local process metrics currently require Windows.');
    const script = fileURLToPath(new URL('../../scripts/process-memory.ps1', import.meta.url));
    const task = Bun.spawn(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
        stdout: 'pipe', stderr: 'pipe', windowsHide: true,
    });
    const timeout = setTimeout(() => task.kill(), 8000);
    try {
        const [output, , code] = await Promise.all([
            new Response(task.stdout).text(), new Response(task.stderr).text(), task.exited,
        ]);
        if (code !== 0) throw new Error('Could not read local process memory.');
        return JSON.parse(output.replace(/^\uFEFF/, ''));
    } finally { clearTimeout(timeout); }
}

// One collection for every open dashboard; no background sampling when unused.
export function createMemorySampler(collect = collectWindowsMemory, now = Date.now) {
    let cached: MemorySnapshot | undefined;
    let collectedAt = 0;
    let pending: Promise<MemorySnapshot> | undefined;
    return () => {
        if (cached && now() - collectedAt < 5000) return Promise.resolve(cached);
        if (pending) return pending;
        pending = collect().then(snapshot => {
            cached = snapshot;
            collectedAt = now();
            return snapshot;
        }).finally(() => { pending = undefined; });
        return pending;
    };
}

const isLoopback = (hostname: string) => ['localhost', '127.0.0.1', '::1', '[::1]', '::ffff:127.0.0.1'].includes(hostname);

export async function localMetricsResponse(
    req: Request, peer: string, enabled: boolean, sample: () => Promise<MemorySnapshot>,
): Promise<Response> {
    if (!enabled || !isLoopback(peer)) return new Response('Not found', { status: 404 });
    const origin = req.headers.get('Origin');
    if (origin) {
        try {
            const url = new URL(origin);
            if (!isLoopback(url.hostname) || !['http:', 'https:'].includes(url.protocol)) throw new Error();
        } catch { return new Response('Local viewer origins only', { status: 403 }); }
    }
    const headers = {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
        ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'GET') return new Response(null, { status: 405, headers });
    try { return Response.json(await sample(), { headers }); }
    catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'Memory sampling failed.' }, { status: 503, headers });
    }
}
