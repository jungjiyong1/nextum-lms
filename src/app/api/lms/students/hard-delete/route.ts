import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import { assertReauthCookie } from '@/lib/lms/reauth';
import { hardDeleteStudentForAcademy } from '@/lib/lms/student-admin';
import { loadStudentHardDeletePreview } from '@/lib/lms/student-queries';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        const body = await request.json() as { academyId?: string; studentId?: string; confirmName?: string };
        if (!body.academyId || !body.studentId || !body.confirmName) {
            return Response.json({ success: false, error: 'Invalid hard delete request.' }, { status: 400 });
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin']);
        await assertReauthCookie({ userId: actor.userId, academyId: body.academyId });

        const preview = await loadStudentHardDeletePreview(body.academyId, body.studentId);
        if (body.confirmName.trim() !== preview.studentName) {
            return Response.json({ success: false, error: 'Student name confirmation does not match.' }, { status: 400 });
        }
        if (!preview.canHardDelete) {
            return Response.json({ success: false, error: 'This student has historical records and can only be archived.' }, { status: 409 });
        }

        const result = await hardDeleteStudentForAcademy(body.academyId, body.studentId, actor);

        return Response.json({ success: true, data: result });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Student Hard Delete] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Student hard delete failed.',
        }, { status: 500 });
    }
}
