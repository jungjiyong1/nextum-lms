export const ASSIGNMENT_MATCH_BATCH_QUERY_PARAM = 'matchBatch';
const ASSIGNMENT_MATCH_STORAGE_PREFIX = 'nextum:assignment-match:active-batch';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function assignmentMatchStorageKey(academyId: string): string {
    return `${ASSIGNMENT_MATCH_STORAGE_PREFIX}:${academyId}`;
}

export function normalizeAssignmentMatchBatchId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLocaleLowerCase('en-US');
    return UUID_PATTERN.test(normalized) ? normalized : null;
}

export function activeAssignmentMatchBatchId(
    currentUrl: string,
    storedValue: string | null | undefined,
): string | null {
    const fromUrl = normalizeAssignmentMatchBatchId(new URL(currentUrl).searchParams.get(ASSIGNMENT_MATCH_BATCH_QUERY_PARAM));
    return fromUrl || normalizeAssignmentMatchBatchId(storedValue);
}

export function assignmentMatchUrlWithBatchId(currentUrl: string, batchId: string | null): string {
    const url = new URL(currentUrl);
    const normalized = normalizeAssignmentMatchBatchId(batchId);
    if (normalized) url.searchParams.set(ASSIGNMENT_MATCH_BATCH_QUERY_PARAM, normalized);
    else url.searchParams.delete(ASSIGNMENT_MATCH_BATCH_QUERY_PARAM);
    return `${url.pathname}${url.search}${url.hash}`;
}
