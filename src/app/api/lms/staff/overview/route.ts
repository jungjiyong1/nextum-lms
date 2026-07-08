import { authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { loadStaffOperationsOverview } from '@/lib/lms/staff-queries';

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
        const academyId = new URL(request.url).searchParams.get('academyId') || '';
        if (!academyId) {
            return noStoreJson({ success: false, error: 'Invalid staff overview request.' }, { status: 400 });
        }

        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        const data = await loadStaffOperationsOverview(actor);

        return noStoreJson({ success: true, data });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Staff Overview] Failed:', error);
        return noStoreJson({
            success: false,
            error: error instanceof Error ? error.message : 'Staff overview loading failed.',
        }, { status: 500 });
    }
}
