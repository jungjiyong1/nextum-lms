import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './limited-concurrency';

describe('bounded concurrency', () => {
    it('caps active work and preserves input result order', async () => {
        let active = 0;
        let peak = 0;
        const results = await mapWithConcurrency([4, 3, 2, 1], 2, async (value) => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, value));
            active -= 1;
            return value * 10;
        });
        expect(peak).toBeLessThanOrEqual(2);
        expect(results).toEqual([40, 30, 20, 10]);
    });

    it('rejects an invalid limit', async () => {
        await expect(mapWithConcurrency([1], 0, async (value) => value)).rejects.toThrow('concurrency');
    });
});
