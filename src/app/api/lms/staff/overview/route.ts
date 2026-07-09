import { authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { loadStaffOperationsOverview } from '@/lib/lms/staff-queries';
import { ApiContractError } from '@/lib/lms/api-contracts';

function noStoreJson(body: unknown, init?: ResponseInit) {
    return Response.json(body, {
        ...init,
        headers: {
            'Cache-Control': 'no-store',
            ...init?.headers,
        },
    });
}

export async function GET(request: Request) {
    try {
        const params = new URL(request.url).searchParams;
        const academyId = params.get('academyId') || '';
        if (!academyId) {
            return noStoreJson({ success: false, error: 'Invalid staff overview request.' }, { status: 400 });
        }

        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        const data = await loadStaffOperationsOverview(actor, {
            cursor: params.get('cursor'),
            limit: params.get('limit'),
            q: params.get('q'),
            role: params.get('role'),
            status: params.get('status'),
            signal: request.signal,
        });

        return noStoreJson({ success: true, data });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        if (error instanceof ApiContractError) {
            return noStoreJson({ success: false, error: error.apiError }, {
                status: 400,
                headers: { 'X-Request-Id': error.apiError.requestId },
            });
        }

        console.error('[LMS Staff Overview] Failed:', error);
        return noStoreJson({
            success: false,
            error: error instanceof Error ? error.message : 'Staff overview loading failed.',
        }, { status: 500 });
    }
}
