import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import { archiveStaffForAcademy } from '@/lib/lms/staff-admin';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        const body = await request.json() as { academyId?: string; staffId?: string };
        if (!body.academyId || !body.staffId) {
            return mutationError('INVALID_STAFF_ARCHIVE_REQUEST', 'Invalid staff archive request.', { request });
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin']);
        const result = await archiveStaffForAcademy(body.academyId, body.staffId, actor);

        return mutationSuccess(result, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Staff Archive] Failed:', error);
        return mutationException(error, 'STAFF_ARCHIVE_FAILED', 'Staff archive failed.', { request });
    }
}
