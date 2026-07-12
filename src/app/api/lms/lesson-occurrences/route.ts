import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import {
    assertDurableClassOperatorAccess,
    assertOccurrenceStatusAccess,
} from '@/lib/lms/class-access';
import { mutateScheduleForAcademy, updateLessonOccurrenceForAcademy } from '@/lib/lms/mutations';
import type { ScheduleMutationInput, UpdateLessonOccurrenceInput } from '@/features/lms/types';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; input?: UpdateLessonOccurrenceInput; mutation?: ScheduleMutationInput };
        if (!body.academyId || (!body.input && !body.mutation)) {
            return mutationError('INVALID_LESSON_OCCURRENCE_REQUEST', 'Invalid lesson occurrence request.', { request });
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        if (body.mutation) {
            await assertDurableClassOperatorAccess(actor, body.mutation);
            const data = await mutateScheduleForAcademy(body.academyId, body.mutation, actor);
            return mutationSuccess(data, { request });
        }
        const access = await assertOccurrenceStatusAccess(actor, body.input!);
        if (access === 'occurrence_participant' && (
            !body.input!.occurrenceId
            || body.input!.instructorId !== undefined
            || body.input!.instructorIds !== undefined
            || body.input!.participants !== undefined
            || body.input!.classroomId !== undefined
            || body.input!.substituteInstructorId !== undefined
            || body.input!.overrideScope !== undefined
        )) {
            return mutationError(
                'LESSON_STRUCTURE_FORBIDDEN',
                'One-off lesson participants can update status and notes only.',
                { request, status: 403 },
            );
        }
        await updateLessonOccurrenceForAcademy(body.academyId, body.input!);

        return mutationSuccess(null, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Lesson Occurrences] Failed:', error);
        return mutationException(error, 'LESSON_OCCURRENCE_UPDATE_FAILED', 'Lesson occurrence update failed.', { request });
    }
}
