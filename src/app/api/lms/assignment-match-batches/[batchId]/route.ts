import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';
import { assignmentMatchErrorResponse, loadAssignmentMatchBatch } from '@/lib/lms/assignment-match';
import { assertLmsRoleForAcademy, authErrorResponse } from '@/lib/lms/auth';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ batchId: string }> },
) {
    try {
        const academyId = new URL(request.url).searchParams.get('academyId') || '';
        const { batchId } = await params;
        if (!academyId || !batchId) {
            return mutationError('INVALID_MATCH_REQUEST', 'An academy and match batch are required.', { request });
        }
        const actor = await assertLmsRoleForAcademy(
            academyId,
            ['owner', 'admin', 'staff', 'teacher', 'instructor'],
        );
        return mutationSuccess(await loadAssignmentMatchBatch(actor, batchId), { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        const matchResponse = assignmentMatchErrorResponse(error, request);
        if (matchResponse) return matchResponse;
        console.error('[LMS PDF match batch detail] Failed:', error);
        return mutationException(error, 'MATCH_BATCH_LOAD_FAILED', 'The PDF match batch could not be loaded.', { request });
    }
}
