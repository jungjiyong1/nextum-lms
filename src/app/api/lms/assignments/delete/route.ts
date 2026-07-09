import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { deleteLearningAssignmentForAcademy } from '@/lib/lms/mutations';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as {
            academyId?: string;
            assignmentId?: string;
        };
        if (!body.academyId || !body.assignmentId) {
            return mutationError('INVALID_ASSIGNMENT_DELETE_REQUEST', 'Invalid assignment delete request.', { request });
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        await deleteLearningAssignmentForAcademy(actor, body.assignmentId);

        return mutationSuccess(null, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Assignment Delete] Failed:', error);
        return mutationException(error, 'ASSIGNMENT_DELETE_FAILED', 'Assignment delete failed.', { request });
    }
}
