import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import { loadStudentHardDeletePreview } from '@/lib/lms/student-queries';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        const body = await request.json() as { academyId?: string; studentId?: string };
        if (!body.academyId || !body.studentId) {
            return Response.json({ success: false, error: 'Invalid hard delete preview request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin']);
        const data = await loadStudentHardDeletePreview(body.academyId, body.studentId);

        return Response.json({ success: true, data });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Student Hard Delete Preview] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Hard delete preview failed.',
        }, { status: 500 });
    }
}
