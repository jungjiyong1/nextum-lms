import type { FinalizePdfAssignmentMatchJobInput } from '@/features/lms/pdf-assignment-match-types';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';
import { assignmentMatchErrorResponse, finalizeAssignmentMatchJob } from '@/lib/lms/assignment-match';
import { assertLmsRoleForAcademy, assertSameOrigin, authErrorResponse } from '@/lib/lms/auth';

export const maxDuration = 60;

export async function POST(
    request: Request,
    { params }: { params: Promise<{ jobId: string }> },
) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as Partial<FinalizePdfAssignmentMatchJobInput> & { academyId?: string };
        const { jobId } = await params;
        if (!body.academyId || !jobId) {
            return mutationError('INVALID_MATCH_REQUEST', 'An academy and PDF match job are required.', { request });
        }
        const actor = await assertLmsRoleForAcademy(
            body.academyId,
            ['owner', 'admin', 'staff', 'teacher', 'instructor'],
        );
        const data = await finalizeAssignmentMatchJob(actor, jobId, body as FinalizePdfAssignmentMatchJobInput);
        return mutationSuccess(data, {
            request,
            invalidation: { eventId: data.mutationId || crypto.randomUUID(), domains: ['assignments'] },
        });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        const matchResponse = assignmentMatchErrorResponse(error, request);
        if (matchResponse) return matchResponse;
        console.error('[LMS PDF match finalize] Failed:', error);
        return mutationException(error, 'MATCH_JOB_FINALIZE_FAILED', 'The PDF assignment could not be finalized.', { request });
    }
}
