export const ASSIGNMENT_MATCH_ITEM_PAGE_SIZE = 1_000;
export const ASSIGNMENT_MATCH_JOB_READ_CONCURRENCY = 5;

export type AssignmentMatchPageLoader<T> = (
    jobId: string,
    from: number,
    to: number,
) => Promise<readonly T[]>;

async function loadAllPagesForJob<T>(
    jobId: string,
    loadPage: AssignmentMatchPageLoader<T>,
    pageSize: number,
): Promise<T[]> {
    const rows: T[] = [];
    let from = 0;

    while (true) {
        const page = await loadPage(jobId, from, from + pageSize - 1);
        if (page.length === 0) return rows;
        rows.push(...page);

        // Advance by what the server actually returned. PostgREST may cap a
        // requested range below pageSize through the project's max_rows setting.
        from += page.length;
    }
}

export async function loadAllAssignmentMatchItemsByJob<T>(
    jobIds: readonly string[],
    loadPage: AssignmentMatchPageLoader<T>,
    options: { pageSize?: number; concurrency?: number } = {},
): Promise<T[]> {
    const pageSize = options.pageSize ?? ASSIGNMENT_MATCH_ITEM_PAGE_SIZE;
    const concurrency = options.concurrency ?? ASSIGNMENT_MATCH_JOB_READ_CONCURRENCY;
    if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('pageSize must be a positive integer.');
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be a positive integer.');

    const rows: T[] = [];
    for (let offset = 0; offset < jobIds.length; offset += concurrency) {
        const jobResults = await Promise.all(
            jobIds
                .slice(offset, offset + concurrency)
                .map((jobId) => loadAllPagesForJob(jobId, loadPage, pageSize)),
        );
        for (const jobRows of jobResults) rows.push(...jobRows);
    }
    return rows;
}
