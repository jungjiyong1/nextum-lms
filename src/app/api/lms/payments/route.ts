import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { recordPaymentForAcademy } from '@/lib/lms/mutations';
import type { RecordPaymentInput } from '@/features/lms/types';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; input?: RecordPaymentInput };
        if (!body.academyId || !body.input) {
            return mutationError('INVALID_PAYMENT_REQUEST', 'Invalid payment request.', { request });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        await recordPaymentForAcademy(body.academyId, body.input);

        return mutationSuccess(null, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Payments] Failed:', error);
        return mutationException(error, 'PAYMENT_RECORDING_FAILED', 'Payment recording failed.', { request });
    }
}
