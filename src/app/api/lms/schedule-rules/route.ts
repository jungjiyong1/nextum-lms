import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertDurableClassOperatorAccess } from '@/lib/lms/class-access';
import { createScheduleRuleForAcademy, mutateScheduleForAcademy, updateScheduleRuleForAcademy } from '@/lib/lms/mutations';
import type { CreateScheduleRuleInput, ScheduleMutationInput, UpdateScheduleRuleInput } from '@/features/lms/types';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as {
            academyId?: string;
            ruleId?: string;
            input?: CreateScheduleRuleInput | UpdateScheduleRuleInput;
            mutation?: ScheduleMutationInput;
        };
        if (!body.academyId || (!body.input && !body.mutation)) {
            return mutationError('INVALID_SCHEDULE_RULE_REQUEST', 'Invalid schedule rule request.', { request });
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        if (body.mutation) {
            await assertDurableClassOperatorAccess(actor, body.mutation);
            const data = await mutateScheduleForAcademy(body.academyId, body.mutation, actor);
            return mutationSuccess(data, { request });
        }
        await assertDurableClassOperatorAccess(actor, {
            classId: body.input!.classId,
            ruleId: body.ruleId || null,
        });
        if (body.ruleId) {
            await updateScheduleRuleForAcademy(body.academyId, body.ruleId, body.input as UpdateScheduleRuleInput);
        } else {
            await createScheduleRuleForAcademy(body.academyId, body.input as CreateScheduleRuleInput);
        }

        return mutationSuccess(null, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Schedule Rules] Failed:', error);
        return mutationException(error, 'SCHEDULE_RULE_OPERATION_FAILED', 'Schedule rule creation failed.', { request });
    }
}
