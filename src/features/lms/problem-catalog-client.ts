import type { ApiResult, CursorPage } from '@/lib/lms/api-contracts';
import type { AssignmentProblemSummary } from './types';

export interface ProblemCatalogRequest {
    academyId: string;
    bookId: string;
    unitId?: string | null;
    problemTypeId?: string | null;
    pagePrinted?: number | null;
    cursor?: string | null;
    limit?: number;
    signal?: AbortSignal;
}

export async function loadAssignmentProblemCatalog(
    request: ProblemCatalogRequest,
): Promise<CursorPage<AssignmentProblemSummary>> {
    const params = new URLSearchParams({
        academyId: request.academyId,
        bookId: request.bookId,
    });
    if (request.unitId) params.set('unitId', request.unitId);
    if (request.problemTypeId) params.set('problemTypeId', request.problemTypeId);
    if (request.pagePrinted !== null && request.pagePrinted !== undefined) {
        params.set('pagePrinted', String(request.pagePrinted));
    }
    if (request.cursor) params.set('cursor', request.cursor);
    if (request.limit !== undefined) params.set('limit', String(request.limit));

    const response = await fetch(`/api/lms/assignments/catalog?${params.toString()}`, {
        cache: 'no-store',
        signal: request.signal,
    });
    const result = await response.json() as ApiResult<CursorPage<AssignmentProblemSummary>>;
    if (!response.ok || !result.success) {
        const message = !result.success
            ? result.error.message
            : `Problem catalog request failed (${response.status}).`;
        throw new Error(message);
    }
    return result.data;
}
