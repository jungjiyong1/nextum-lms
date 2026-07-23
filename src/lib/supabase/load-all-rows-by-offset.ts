import type { SupabasePage } from './load-all-rows-by-id';

export async function loadAllRowsByOffset<T>(
    loadPage: (from: number, to: number) => PromiseLike<SupabasePage<T>>,
    context: string,
    pageSize = 1_000,
    concurrency = 8,
): Promise<T[]> {
    if (!Number.isInteger(pageSize) || pageSize <= 0) {
        throw new Error('pageSize must be a positive integer');
    }
    if (!Number.isInteger(concurrency) || concurrency <= 0) {
        throw new Error('concurrency must be a positive integer');
    }

    const rows: T[] = [];
    let pageIndex = 0;

    for (;;) {
        const pages = await Promise.all(
            Array.from({ length: concurrency }, (_, offset) => {
                const from = (pageIndex + offset) * pageSize;
                return loadPage(from, from + pageSize - 1);
            }),
        );

        for (const { data, error } of pages) {
            if (error) {
                throw new Error(`${context}: ${error.message ?? 'Unknown Supabase error'}`);
            }

            const page = data || [];
            rows.push(...page);
            if (page.length < pageSize) return rows;
        }

        pageIndex += concurrency;
    }
}
