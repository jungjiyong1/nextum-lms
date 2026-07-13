import type { PatchPdfAssignmentMatchJobInput } from '@/features/lms/pdf-assignment-match-types';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';
import {
    assignmentMatchErrorResponse,
    loadAssignmentMatchJob,
    patchAssignmentMatchJob,
} from '@/lib/lms/assignment-match';
import { assertLmsRoleForAcademy, assertSameOrigin, authErrorResponse } from '@/lib/lms/auth';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ jobId: string }> },
) {
    try {
        const academyId = new URL(request.url).searchParams.get('academyId') || '';
        const { jobId } = await params;
        if (!academyId || !jobId) {
            return mutationError('INVALID_MATCH_REQUEST', 'An academy and PDF match job are required.', { request });
        }
        const actor = await assertLmsRoleForAcademy(
            academyId,
            ['owner', 'admin', 'staff', 'teacher', 'instructor'],
        );
        return mutationSuccess(await loadAssignmentMatchJob(actor, jobId), { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        const matchResponse = assignmentMatchErrorResponse(error, request);
        if (matchResponse) return matchResponse;
        console.error('[LMS PDF match job detail] Failed:', error);
        return mutationException(error, 'MATCH_JOB_LOAD_FAILED', 'The PDF match job could not be loaded.', { request });
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ jobId: string }> },
) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as Partial<PatchPdfAssignmentMatchJobInput> & { academyId?: string };
        const { jobId } = await params;
        if (!body.academyId || !jobId) {
            return mutationError('INVALID_MATCH_REQUEST', 'An academy and PDF match job are required.', { request });
        }
        const actor = await assertLmsRoleForAcademy(
            body.academyId,
            ['owner', 'admin', 'staff', 'teacher', 'instructor'],
        );
        return mutationSuccess(
            await patchAssignmentMatchJob(actor, jobId, body as PatchPdfAssignmentMatchJobInput),
            { request },
        );
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        const matchResponse = assignmentMatchErrorResponse(error, request);
        if (matchResponse) return matchResponse;
        console.error('[LMS PDF match job update] Failed:', error);
        return mutationException(error, 'MATCH_JOB_UPDATE_FAILED', 'The PDF match job could not be updated.', { request });
    }
}
