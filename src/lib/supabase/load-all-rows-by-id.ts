type SupabasePageError = {
    message?: string;
} | null;

export type SupabasePage<T> = {
    data: T[] | null;
    error: SupabasePageError;
};

export async function loadAllRowsById<T>(
    loadPage: (afterId: string | null, limit: number) => PromiseLike<SupabasePage<T>>,
    context: string,
    pageSize = 1_000,
): Promise<T[]> {
    if (!Number.isInteger(pageSize) || pageSize <= 0) {
        throw new Error('pageSize must be a positive integer');
    }

    const rows: T[] = [];
    const seenIds = new Set<string>();
    let afterId: string | null = null;

    for (;;) {
        const { data, error } = await loadPage(afterId, pageSize);
        if (error) {
            throw new Error(`${context}: ${error.message ?? 'Unknown Supabase error'}`);
        }

        const page = data || [];
        if (page.length === 0) return rows;

        let lastId: string | null = null;
        for (const row of page) {
            const rowId = (row as { id?: unknown }).id;
            if (typeof rowId !== 'string' || rowId.length === 0) {
                throw new Error(`${context}: Supabase page contains a row without a valid id`);
            }
            if (seenIds.has(rowId)) {
                throw new Error(`${context}: Supabase page did not advance to a new id`);
            }
            seenIds.add(rowId);
            rows.push(row);
            lastId = rowId;
        }

        afterId = lastId;
    }
}
