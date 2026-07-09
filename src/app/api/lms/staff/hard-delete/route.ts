import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import { assertReauthCookie } from '@/lib/lms/reauth';
import { hardDeleteStaffForAcademy } from '@/lib/lms/staff-admin';
import { loadStaffHardDeletePreview } from '@/lib/lms/staff-queries';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        const body = await request.json() as { academyId?: string; staffId?: string; confirmName?: string };
        if (!body.academyId || !body.staffId || !body.confirmName) {
            return mutationError('INVALID_STAFF_HARD_DELETE_REQUEST', 'Invalid staff hard delete request.', { request });
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin']);
        await assertReauthCookie({ userId: actor.userId, academyId: body.academyId });

        const preview = await loadStaffHardDeletePreview(body.academyId, body.staffId);
        if (body.confirmName.trim() !== preview.staffName) {
            return mutationError('STAFF_CONFIRMATION_MISMATCH', 'Staff name confirmation does not match.', { request });
        }
        if (!preview.canHardDelete) {
            return mutationError('STAFF_HAS_HISTORY', 'This staff member has historical records and can only be archived.', { request, status: 409 });
        }

        const result = await hardDeleteStaffForAcademy(body.academyId, body.staffId, actor);

        return mutationSuccess(result, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Staff Hard Delete] Failed:', error);
        return mutationException(error, 'STAFF_HARD_DELETE_FAILED', 'Staff hard delete failed.', { request });
    }
}
