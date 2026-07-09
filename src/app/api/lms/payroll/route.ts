import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createInstructorPaymentForAcademy } from '@/lib/lms/mutations';
import type { CreateInstructorPaymentInput } from '@/features/lms/types';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; input?: CreateInstructorPaymentInput };
        if (!body.academyId || !body.input) {
            return mutationError('INVALID_PAYROLL_REQUEST', 'Invalid payroll request.', { request });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        await createInstructorPaymentForAcademy(body.academyId, body.input);

        return mutationSuccess(null, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Payroll] Failed:', error);
        return mutationException(error, 'PAYROLL_CREATION_FAILED', 'Payroll creation failed.', { request });
    }
}
