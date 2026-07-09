import { type ApiError, ApiContractError, type ApiResult } from '@/lib/lms/api-contracts';
import { assertLmsRoleForAcademy, authErrorResponse } from '@/lib/lms/auth';
import { loadProblemCatalogPage } from '@/lib/lms/problem-catalog';

function noStoreJson<T>(body: ApiResult<T>, requestId: string, init?: ResponseInit) {
    return Response.json(body, {
        ...init,
        headers: {
            'Cache-Control': 'no-store',
            'X-Request-Id': requestId,
            ...init?.headers,
        },
    });
}

function failure(error: Omit<ApiError, 'requestId'>, requestId: string, status: number) {
    return noStoreJson({ success: false, error: { ...error, requestId } }, requestId, { status });
}

export async function GET(request: Request) {
    const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
    try {
        const params = new URL(request.url).searchParams;
        const academyId = params.get('academyId') || '';
        const bookId = params.get('bookId') || '';
        if (!academyId || !bookId) {
            return failure({
                code: 'INVALID_REQUEST',
                message: 'academyId and bookId are required.',
            }, requestId, 400);
        }

        const pageValue = params.get('pagePrinted');
        const context = await assertLmsRoleForAcademy(
            academyId,
            ['owner', 'admin', 'staff', 'teacher', 'instructor'],
        );
        const page = await loadProblemCatalogPage(context, {
            bookId,
            unitId: params.get('unitId'),
            problemTypeId: params.get('problemTypeId'),
            pagePrinted: pageValue === null ? null : Number(pageValue),
            cursor: params.get('cursor'),
            limit: params.get('limit'),
        });
        return noStoreJson({ success: true, data: page }, requestId);
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        if (error instanceof ApiContractError) {
            const status = error.apiError.code === 'CATALOG_NOT_FOUND' ? 404 : 400;
            return failure({
                code: error.apiError.code,
                message: error.apiError.message,
                fieldErrors: error.apiError.fieldErrors,
            }, requestId, status);
        }

        console.error('[LMS Assignment Catalog] Failed:', error);
        return failure({
            code: 'CATALOG_LOAD_FAILED',
            message: error instanceof Error ? error.message : 'Problem catalog loading failed.',
        }, requestId, 500);
    }
}
