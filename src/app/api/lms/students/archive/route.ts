import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import { archiveStudentForAcademy } from '@/lib/lms/student-admin';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        const body = await request.json() as { academyId?: string; studentId?: string };
        if (!body.academyId || !body.studentId) {
            return mutationError('INVALID_STUDENT_ARCHIVE_REQUEST', 'Invalid student archive request.', { request });
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        const result = await archiveStudentForAcademy(body.academyId, body.studentId, actor);

        return mutationSuccess(result, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Student Archive] Failed:', error);
        return mutationException(error, 'STUDENT_ARCHIVE_FAILED', 'Student archive failed.', { request });
    }
}
