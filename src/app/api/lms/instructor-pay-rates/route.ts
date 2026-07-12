import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';
import { upsertInstructorPayRateForAcademy } from '@/lib/lms/mutations';
import type { UpsertInstructorPayRateInput } from '@/features/lms/types';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as {
            academyId?: string;
            input?: UpsertInstructorPayRateInput;
        };
        if (!body.academyId || !body.input) {
            return mutationError('INVALID_INSTRUCTOR_PAY_RATE_REQUEST', 'Invalid instructor pay-rate request.', { request });
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        await upsertInstructorPayRateForAcademy(body.academyId, body.input, actor.personId);
        return mutationSuccess(null, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Instructor Pay Rate] Failed:', error);
        return mutationException(
            error,
            'INSTRUCTOR_PAY_RATE_SAVE_FAILED',
            'Instructor pay-rate saving failed.',
            { request },
        );
    }
}
