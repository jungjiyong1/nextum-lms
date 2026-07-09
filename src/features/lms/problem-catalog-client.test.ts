import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAssignmentProblemCatalog } from './problem-catalog-client';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('loadAssignmentProblemCatalog', () => {
    it('serializes filters and forwards AbortSignal', async () => {
        const controller = new AbortController();
        const page = { items: [], nextCursor: null, hasMore: false, totalCount: 0 };
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: page }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(loadAssignmentProblemCatalog({
            academyId: 'academy-1',
            bookId: 'book-1',
            unitId: 'unit-1',
            limit: 25,
            signal: controller.signal,
        })).resolves.toEqual(page);

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('academyId=academy-1');
        expect(url).toContain('bookId=book-1');
        expect(url).toContain('unitId=unit-1');
        expect(url).toContain('limit=25');
        expect(init.signal).toBe(controller.signal);
    });

    it('surfaces the structured API error message', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            success: false,
            error: { code: 'INVALID_CURSOR', message: 'Cursor is stale.' },
        }), { status: 400 })));

        await expect(loadAssignmentProblemCatalog({
            academyId: 'academy-1',
            bookId: 'book-1',
        })).rejects.toThrow('Cursor is stale.');
    });
});
