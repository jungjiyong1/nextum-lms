import { authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { loadAssignmentDetail } from '@/lib/lms/assignment-queries';

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
        const assignmentId = params.get('assignmentId') || '';
        if (!academyId || !assignmentId) {
            return noStoreJson({ success: false, error: 'Invalid assignment detail request.' }, { status: 400 });
        }

        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        const data = await loadAssignmentDetail(actor, assignmentId);
        return noStoreJson({ success: true, data });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Assignment Detail] Failed:', error);
        return noStoreJson({
            success: false,
            error: error instanceof Error ? error.message : 'Assignment detail loading failed.',
        }, { status: 500 });
    }
}
