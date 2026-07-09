import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { generateMonthlyInvoicesForAcademy } from '@/lib/lms/mutations';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; serviceMonth?: string };
        if (!body.academyId || !body.serviceMonth) {
            return mutationError('INVALID_BILLING_REQUEST', 'Invalid billing request.', { request });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        await generateMonthlyInvoicesForAcademy(body.academyId, body.serviceMonth);

        return mutationSuccess(null, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Billing Generate] Failed:', error);
        return mutationException(error, 'BILLING_GENERATION_FAILED', 'Billing generation failed.', { request });
    }
}
