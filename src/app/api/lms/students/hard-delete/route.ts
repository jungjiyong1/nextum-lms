import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import { assertReauthCookie } from '@/lib/lms/reauth';
import { hardDeleteStudentForAcademy } from '@/lib/lms/student-admin';
import { loadStudentHardDeletePreview } from '@/lib/lms/student-queries';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        const body = await request.json() as { academyId?: string; studentId?: string; confirmName?: string };
        if (!body.academyId || !body.studentId || !body.confirmName) {
            return mutationError('INVALID_STUDENT_HARD_DELETE_REQUEST', 'Invalid hard delete request.', { request });
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin']);
        await assertReauthCookie({ userId: actor.userId, academyId: body.academyId });

        const preview = await loadStudentHardDeletePreview(body.academyId, body.studentId);
        if (body.confirmName.trim() !== preview.studentName) {
            return mutationError('STUDENT_CONFIRMATION_MISMATCH', 'Student name confirmation does not match.', { request });
        }
        if (!preview.canHardDelete) {
            return mutationError('STUDENT_HAS_HISTORY', 'This student has historical records and can only be archived.', { request, status: 409 });
        }

        const result = await hardDeleteStudentForAcademy(body.academyId, body.studentId, actor);

        return mutationSuccess(result, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Student Hard Delete] Failed:', error);
        return mutationException(error, 'STUDENT_HARD_DELETE_FAILED', 'Student hard delete failed.', { request });
    }
}
