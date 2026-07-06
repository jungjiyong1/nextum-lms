import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import { archiveStudentForAcademy } from '@/lib/lms/student-admin';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        const body = await request.json() as { academyId?: string; studentId?: string };
        if (!body.academyId || !body.studentId) {
            return Response.json({ success: false, error: 'Invalid student archive request.' }, { status: 400 });
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        const result = await archiveStudentForAcademy(body.academyId, body.studentId, actor);

        return Response.json({ success: true, data: result });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Student Archive] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Student archive failed.',
        }, { status: 500 });
    }
}
