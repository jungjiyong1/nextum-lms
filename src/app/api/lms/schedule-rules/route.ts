import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createScheduleRuleForAcademy, updateScheduleRuleForAcademy } from '@/lib/lms/mutations';
import type { CreateScheduleRuleInput, UpdateScheduleRuleInput } from '@/features/lms/types';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as {
            academyId?: string;
            ruleId?: string;
            input?: CreateScheduleRuleInput | UpdateScheduleRuleInput;
        };
        if (!body.academyId || !body.input) {
            return Response.json({ success: false, error: 'Invalid schedule rule request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        if (body.ruleId) {
            await updateScheduleRuleForAcademy(body.academyId, body.ruleId, body.input as UpdateScheduleRuleInput);
        } else {
            await createScheduleRuleForAcademy(body.academyId, body.input as CreateScheduleRuleInput);
        }

        return Response.json({ success: true });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Schedule Rules] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Schedule rule creation failed.',
        }, { status: 500 });
    }
}
