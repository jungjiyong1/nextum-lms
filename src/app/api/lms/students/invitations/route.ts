import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { issueStudentInvitationForAcademy } from '@/lib/lms/mutations';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as {
            academyId?: string;
            studentId?: string;
            loginHint?: string | null;
        };
        if (!body.academyId || !body.studentId) {
            return mutationError('INVALID_INVITATION_REQUEST', 'Invalid invitation request.', { request });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        const invitation = await issueStudentInvitationForAcademy(
            body.academyId,
            body.studentId,
            body.loginHint,
        );

        return mutationSuccess(invitation, { request, aliases: { invitation } });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Student Invitations] Failed:', error);
        return mutationException(error, 'STUDENT_INVITATION_FAILED', 'Student invitation failed.', { request });
    }
}
