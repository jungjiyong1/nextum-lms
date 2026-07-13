import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';
import {
    assignmentMatchErrorResponse,
    createAssignmentMatchBatch,
} from '@/lib/lms/assignment-match';
import { assertLmsRoleForAcademy, assertSameOrigin, authErrorResponse } from '@/lib/lms/auth';
import type { CreatePdfAssignmentMatchBatchInput } from '@/features/lms/pdf-assignment-match-types';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as Partial<CreatePdfAssignmentMatchBatchInput> & { academyId?: string };
        if (!body.academyId) {
            return mutationError('INVALID_MATCH_REQUEST', 'An academy id is required.', { request });
        }
        const actor = await assertLmsRoleForAcademy(
            body.academyId,
            ['owner', 'admin', 'staff', 'teacher', 'instructor'],
        );
        const data = await createAssignmentMatchBatch(actor, body as CreatePdfAssignmentMatchBatchInput);
        return mutationSuccess(data, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        const matchResponse = assignmentMatchErrorResponse(error, request);
        if (matchResponse) return matchResponse;
        console.error('[LMS PDF match batch] Failed:', error);
        return mutationException(error, 'MATCH_BATCH_CREATION_FAILED', 'The PDF match batch could not be created.', { request });
    }
}
