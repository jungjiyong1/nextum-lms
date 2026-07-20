import { describe, expect, it, vi } from 'vitest';
import { loadAllRowsById, type SupabasePage } from './load-all-rows-by-id';

type TestRow = {
    id: string;
    value: number;
};

describe('loadAllRowsById', () => {
    it('loads every row when the server caps responses below the requested page size', async () => {
        const source = Array.from({ length: 5 }, (_, index) => ({
            id: String(index + 1).padStart(2, '0'),
            value: index + 1,
        }));
        const loadPage = vi.fn(async (afterId: string | null, limit: number): Promise<SupabasePage<TestRow>> => {
            const start = afterId === null
                ? 0
                : source.findIndex((row) => row.id === afterId) + 1;
            const serverCap = 2;
            return {
                data: source.slice(start, start + Math.min(limit, serverCap)),
                error: null,
            };
        });

        await expect(loadAllRowsById(loadPage, 'Failed to load rows', 1_000)).resolves.toEqual(source);
        expect(loadPage).toHaveBeenNthCalledWith(1, null, 1_000);
        expect(loadPage).toHaveBeenNthCalledWith(2, '02', 1_000);
        expect(loadPage).toHaveBeenNthCalledWith(3, '04', 1_000);
        expect(loadPage).toHaveBeenNthCalledWith(4, '05', 1_000);
    });

    it('adds context to a Supabase page error', async () => {
        const loadPage = vi.fn(async (): Promise<SupabasePage<TestRow>> => ({
            data: null,
            error: { message: 'request failed' },
        }));

        await expect(loadAllRowsById(loadPage, 'Failed to load catalog'))
            .rejects.toThrow('Failed to load catalog: request failed');
    });

    it('rejects invalid ids and non-advancing page order', async () => {
        const invalidId = vi.fn(async (): Promise<SupabasePage<TestRow>> => ({
            data: [{ id: '', value: 1 }],
            error: null,
        }));
        await expect(loadAllRowsById(invalidId, 'Failed to load rows'))
            .rejects.toThrow('without a valid id');

        const duplicateId = vi.fn(async (): Promise<SupabasePage<TestRow>> => ({
            data: [
                { id: '01', value: 1 },
                { id: '01', value: 2 },
            ],
            error: null,
        }));
        await expect(loadAllRowsById(duplicateId, 'Failed to load rows'))
            .rejects.toThrow('did not advance to a new id');
    });

    it('rejects invalid page sizes', async () => {
        const loadPage = vi.fn(async (): Promise<SupabasePage<TestRow>> => ({
            data: [],
            error: null,
        }));

        await expect(loadAllRowsById(loadPage, 'Failed to load rows', 0))
            .rejects.toThrow('pageSize');
    });
});
