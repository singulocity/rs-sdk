import '../dom-shim.js';
import { expect, spyOn, test } from 'bun:test';
import { LocIndex } from './LocIndex.js';

test('concurrent sessions share one immutable world index; changed CRCs get fresh data', async () => {
    const source = LocIndex as unknown as { loadUncached(opts: unknown): Promise<LocIndex> };
    const fakeA = {} as LocIndex,
        fakeB = {} as LocIndex;
    const load = spyOn(source, 'loadUncached').mockImplementation(async () => fakeA);
    try {
        const opts = { origin: 'http://test-shared', cacheDir: 'unused', versionlistCrc: 123 };
        const [a, b] = await Promise.all([LocIndex.load(opts), LocIndex.load(opts)]);
        expect(a).toBe(fakeA);
        expect(b).toBe(a);
        expect(load).toHaveBeenCalledTimes(1);
        load.mockImplementation(async () => fakeB);
        expect(await LocIndex.load({ ...opts, versionlistCrc: 124 })).toBe(fakeB);
        expect(load).toHaveBeenCalledTimes(2);
    } finally {
        load.mockRestore();
    }
});
test('a failed world-index load can be retried instead of poisoning every account', async () => {
    const source = LocIndex as unknown as { loadUncached(opts: unknown): Promise<LocIndex> };
    const load = spyOn(source, 'loadUncached')
        .mockRejectedValueOnce(new Error('unavailable'))
        .mockResolvedValue({} as LocIndex);
    try {
        const opts = { origin: 'http://test-retry', cacheDir: 'unused', versionlistCrc: 125 };
        await expect(LocIndex.load(opts)).rejects.toThrow('unavailable');
        await LocIndex.load(opts);
        expect(load).toHaveBeenCalledTimes(2);
    } finally {
        load.mockRestore();
    }
});
