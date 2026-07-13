import type { ResolvePdfAssignmentMatchJobInput } from '@/features/lms/pdf-assignment-match-types';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';
import { assignmentMatchErrorResponse, resolveAssignmentMatchJob } from '@/lib/lms/assignment-match';
import { assertLmsRoleForAcademy, assertSameOrigin, authErrorResponse } from '@/lib/lms/auth';

// A 50 MB / 200-page PDF is streamed, hashed, and parsed server-side.
export const maxDuration = 300;

export async function POST(
    request: Request,
    { params }: { params: Promise<{ jobId: string }> },
) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as Partial<ResolvePdfAssignmentMatchJobInput> & { academyId?: string };
        const { jobId } = await params;
        if (!body.academyId || !jobId) {
            return mutationError('INVALID_MATCH_REQUEST', 'An academy and PDF match job are required.', { request });
        }
        const actor = await assertLmsRoleForAcademy(
            body.academyId,
            ['owner', 'admin', 'staff', 'teacher', 'instructor'],
        );
        return mutationSuccess(
            await resolveAssignmentMatchJob(actor, jobId, body as ResolvePdfAssignmentMatchJobInput),
            { request },
        );
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        const matchResponse = assignmentMatchErrorResponse(error, request);
        if (matchResponse) return matchResponse;
        console.error('[LMS PDF code resolve] Failed:', error);
        return mutationException(error, 'MATCH_JOB_RESOLVE_FAILED', 'The PDF problem codes could not be resolved.', { request });
    }
}
