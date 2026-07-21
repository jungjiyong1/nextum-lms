import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import { issueStaffInvitationForAcademy } from '@/lib/lms/mutations';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        const body = await request.json() as {
            academyId?: string;
            staffId?: string;
            loginHint?: string | null;
        };
        if (!body.academyId || !body.staffId) {
            return mutationError('INVALID_STAFF_INVITATION_REQUEST', 'Invalid staff invitation request.', { request });
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin']);
        const invitation = await issueStaffInvitationForAcademy(
            body.academyId,
            body.staffId,
            body.loginHint,
            actor.personId,
        );
        return mutationSuccess(invitation, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Staff Invitations] Failed:', error);
        return mutationException(error, 'STAFF_INVITATION_FAILED', 'Staff invitation failed.', { request });
    }
}
