import { describe, expect, it, vi } from 'vitest';
import { loadAllRowsByOffset } from './load-all-rows-by-offset';

type TestRow = {
    id: string;
};

describe('loadAllRowsByOffset', () => {
    it('loads ordered pages in bounded parallel batches', async () => {
        const source = Array.from({ length: 10 }, (_, index) => ({ id: String(index + 1) }));
        const loadPage = vi.fn(async (from: number, to: number) => ({
            data: source.slice(from, to + 1),
            error: null,
        }));

        await expect(loadAllRowsByOffset(loadPage, 'Failed to load rows', 3, 2))
            .resolves.toEqual(source);
        expect(loadPage).toHaveBeenCalledTimes(4);
        expect(loadPage).toHaveBeenNthCalledWith(1, 0, 2);
        expect(loadPage).toHaveBeenNthCalledWith(2, 3, 5);
        expect(loadPage).toHaveBeenNthCalledWith(3, 6, 8);
        expect(loadPage).toHaveBeenNthCalledWith(4, 9, 11);
    });

    it('adds context to a Supabase page error', async () => {
        const loadPage = vi.fn(async () => ({
            data: null as TestRow[] | null,
            error: { message: 'request failed' },
        }));

        await expect(loadAllRowsByOffset(loadPage, 'Failed to load catalog'))
            .rejects.toThrow('Failed to load catalog: request failed');
    });

    it('rejects invalid pagination settings', async () => {
        const loadPage = vi.fn(async () => ({ data: [], error: null }));

        await expect(loadAllRowsByOffset(loadPage, 'Failed to load rows', 0))
            .rejects.toThrow('pageSize');
        await expect(loadAllRowsByOffset(loadPage, 'Failed to load rows', 1_000, 0))
            .rejects.toThrow('concurrency');
    });
});
