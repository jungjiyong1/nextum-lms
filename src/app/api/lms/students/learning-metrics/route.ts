import { authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { loadStudentLearningMetrics } from '@/lib/lms/student-queries';

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
        const url = new URL(request.url);
        const academyId = url.searchParams.get('academyId') || '';
        const studentIds = (url.searchParams.get('studentIds') || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);

        if (!academyId || studentIds.length === 0) {
            return noStoreJson({ success: false, error: 'Invalid student metrics request.' }, { status: 400 });
        }

        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        const data = await loadStudentLearningMetrics(actor, studentIds);

        return noStoreJson({ success: true, data });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Student Metrics] Failed:', error);
        return noStoreJson({
            success: false,
            error: error instanceof Error ? error.message : 'Student metrics loading failed.',
        }, { status: 500 });
    }
}
