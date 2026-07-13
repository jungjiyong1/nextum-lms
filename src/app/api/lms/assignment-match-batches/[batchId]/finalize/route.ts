import type { FinalizePdfAssignmentMatchBatchInput } from '@/features/lms/pdf-assignment-match-types';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';
import { assignmentMatchErrorResponse, finalizeAssignmentMatchBatch } from '@/lib/lms/assignment-match';
import { assertLmsRoleForAcademy, assertSameOrigin, authErrorResponse } from '@/lib/lms/auth';

export const maxDuration = 60;

export async function POST(
    request: Request,
    { params }: { params: Promise<{ batchId: string }> },
) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as Partial<FinalizePdfAssignmentMatchBatchInput> & { academyId?: string };
        const { batchId } = await params;
        if (!body.academyId || !batchId) {
            return mutationError('INVALID_MATCH_REQUEST', 'An academy and match batch are required.', { request });
        }
        const actor = await assertLmsRoleForAcademy(
            body.academyId,
            ['owner', 'admin', 'staff', 'teacher', 'instructor'],
        );
        const data = await finalizeAssignmentMatchBatch(actor, batchId, body as FinalizePdfAssignmentMatchBatchInput);
        const eventId = data.succeeded.find((row) => row.mutationId)?.mutationId || crypto.randomUUID();
        return mutationSuccess(data, {
            request,
            invalidation: { eventId, domains: ['assignments'] },
        });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        const matchResponse = assignmentMatchErrorResponse(error, request);
        if (matchResponse) return matchResponse;
        console.error('[LMS PDF match batch finalize] Failed:', error);
        return mutationException(error, 'MATCH_BATCH_FINALIZE_FAILED', 'The PDF match batch could not be finalized.', { request });
    }
}
