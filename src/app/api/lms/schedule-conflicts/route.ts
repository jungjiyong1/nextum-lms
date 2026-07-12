import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertDurableClassOperatorAccess } from '@/lib/lms/class-access';
import { findScheduleConflictsForAcademy } from '@/lib/lms/mutations';
import type { ScheduleMutationInput } from '@/features/lms/types';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; input?: ScheduleMutationInput };
        if (!body.academyId || !body.input?.classId || !body.input.startTime || !body.input.endTime) {
            return mutationError('INVALID_SCHEDULE_CONFLICT_REQUEST', 'Invalid schedule conflict request.', { request });
        }
        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        await assertDurableClassOperatorAccess(actor, body.input);
        const data = await findScheduleConflictsForAcademy(body.academyId, body.input);
        return mutationSuccess(data, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        console.error('[LMS Schedule Conflicts] Failed:', error);
        return mutationException(error, 'SCHEDULE_CONFLICT_CHECK_FAILED', 'Schedule conflict check failed.', { request });
    }
}
