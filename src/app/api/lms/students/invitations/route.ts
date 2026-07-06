import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { issueStudentInvitationForAcademy } from '@/lib/lms/mutations';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as {
            academyId?: string;
            studentId?: string;
            loginHint?: string | null;
        };
        if (!body.academyId || !body.studentId) {
            return Response.json({ success: false, error: 'Invalid invitation request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        const invitation = await issueStudentInvitationForAcademy(
            body.academyId,
            body.studentId,
            body.loginHint,
        );

        return Response.json({ success: true, invitation });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Student Invitations] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Student invitation failed.',
        }, { status: 500 });
    }
}
