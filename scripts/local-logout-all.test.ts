import { expect, test } from 'bun:test';
import { runPool } from './local-logout-all';

test('runs tasks concurrently up to the limit and collects failures', async () => {
    let active = 0;
    let peak = 0;
    const failures = await runPool([1, 2, 3, 4, 5, 6], 3, async n => {
        active++;
        peak = Math.max(peak, active);
        await Bun.sleep(20);
        active--;
        if (n === 4) throw new Error('boom');
    });
    expect(peak).toBe(3);
    expect(failures.map(f => f.item)).toEqual([4]);
});

test('handles an empty list', async () => {
    expect(await runPool([], 10, async () => {})).toEqual([]);
});
