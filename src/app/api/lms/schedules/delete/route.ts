import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertAssignedClassAccess } from '@/lib/lms/class-access';
import { deleteScheduleForAcademy } from '@/lib/lms/mutations';
import type { DeleteScheduleInput } from '@/features/lms/types';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; input?: DeleteScheduleInput };
        if (
            !body.academyId
            || !body.input?.classId
            || !body.input.date
            || (!body.input.ruleId && !body.input.occurrenceId)
        ) {
            return mutationError('INVALID_SCHEDULE_DELETE_REQUEST', 'Invalid schedule delete request.', { request });
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        await assertAssignedClassAccess(actor, body.input);
        const data = await deleteScheduleForAcademy(body.academyId, body.input, actor);
        return mutationSuccess(data, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Schedule Delete] Failed:', error);
        return mutationException(error, 'SCHEDULE_DELETE_FAILED', 'Schedule deletion failed.', { request });
    }
}
