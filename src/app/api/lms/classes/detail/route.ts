import { authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { loadClassOperationsDetail } from '@/lib/lms/class-queries';

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
        const classId = params.get('classId') || '';

        if (!academyId || !classId) {
            return noStoreJson({ success: false, error: 'Invalid class detail request.' }, { status: 400 });
        }

        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        const data = await loadClassOperationsDetail(actor, classId);

        return noStoreJson({ success: true, data });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Class Detail] Failed:', error);
        return noStoreJson({
            success: false,
            error: error instanceof Error ? error.message : 'Class detail loading failed.',
        }, { status: 500 });
    }
}
