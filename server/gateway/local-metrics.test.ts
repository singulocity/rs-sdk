import { expect, test } from 'bun:test';
import { createMemorySampler, localMetricsResponse, type MemorySnapshot } from './local-metrics';

const snapshot: MemorySnapshot = {
    sampledAt: '2026-10-19T00:00:00Z', processes: [],
    totals: { processCount: 0, workingSetBytes: 0, privateBytes: 0 }, host: { totalBytes: 1024, availableBytes: 512 },
};

test('concurrent viewers share a sample and refresh only after five seconds', async () => {
    let calls = 0;
    let clock = 0;
    const sample = createMemorySampler(async () => { calls++; return snapshot; }, () => clock);
    await Promise.all([sample(), sample(), sample()]);
    clock = 4999;
    await sample();
    expect(calls).toBe(1);
    clock = 5000;
    await sample();
    expect(calls).toBe(2);
});

test('a failed collection can be retried without returning stale success', async () => {
    let calls = 0;
    const sample = createMemorySampler(async () => { if (++calls === 1) throw new Error('offline'); return snapshot; });
    await expect(sample()).rejects.toThrow('offline');
    expect(await sample()).toEqual(snapshot);
});

test('memory statistics require opt-in, a loopback peer and a local viewer origin', async () => {
    let calls = 0;
    const sample = async () => { calls++; return snapshot; };
    const request = (origin: string) => new Request('http://localhost:7780/local/metrics', { headers: { Origin: origin } });
    expect((await localMetricsResponse(request('http://localhost:3000'), '127.0.0.1', false, sample)).status).toBe(404);
    expect((await localMetricsResponse(request('http://localhost:3000'), '192.168.1.2', true, sample)).status).toBe(404);
    expect((await localMetricsResponse(request('https://example.com'), '127.0.0.1', true, sample)).status).toBe(403);
    expect(calls).toBe(0);
    const response = await localMetricsResponse(request('http://localhost:3000'), '127.0.0.1', true, sample);
    expect(await response.json()).toEqual(snapshot);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    expect(calls).toBe(1);
});
