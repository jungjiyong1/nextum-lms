import { describe, expect, it, vi } from 'vitest';
import { loadAllAssignmentMatchItemsByJob } from './assignment-match-pagination';

describe('assignment match item pagination', () => {
    it('loads every job-scoped row even when the server caps each response below the requested range', async () => {
        const rowsByJob = new Map([
            ['job-1', Array.from({ length: 5 }, (_, index) => `job-1:${index + 1}`)],
            ['job-2', Array.from({ length: 3 }, (_, index) => `job-2:${index + 1}`)],
        ]);
        const loadPage = vi.fn(async (jobId: string, from: number, to: number) => {
            const serverCap = 2;
            return (rowsByJob.get(jobId) || []).slice(from, Math.min(to + 1, from + serverCap));
        });

        const rows = await loadAllAssignmentMatchItemsByJob(
            ['job-1', 'job-2'],
            loadPage,
            { pageSize: 1_000, concurrency: 1 },
        );

        expect(rows).toEqual([
            'job-1:1', 'job-1:2', 'job-1:3', 'job-1:4', 'job-1:5',
            'job-2:1', 'job-2:2', 'job-2:3',
        ]);
        expect(loadPage).toHaveBeenCalledWith('job-1', 0, 999);
        expect(loadPage).toHaveBeenCalledWith('job-1', 5, 1_004);
        expect(loadPage).toHaveBeenCalledWith('job-2', 3, 1_002);
    });

    it('rejects invalid pagination controls', async () => {
        const loadPage = vi.fn(async () => [] as string[]);
        await expect(loadAllAssignmentMatchItemsByJob(['job'], loadPage, { pageSize: 0 })).rejects.toThrow('pageSize');
        await expect(loadAllAssignmentMatchItemsByJob(['job'], loadPage, { concurrency: 0 })).rejects.toThrow('concurrency');
    });
});
