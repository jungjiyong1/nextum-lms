import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { recordPaymentForAcademy } from '@/lib/lms/mutations';
import type { RecordPaymentInput } from '@/features/lms/types';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';
import { loadStudentPaymentOperationsOverview } from '@/lib/lms/accounting-queries';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: Request) {
    try {
        const params = new URL(request.url).searchParams;
        const academyId = params.get('academyId') || '';
        const serviceMonth = params.get('serviceMonth') || '';
        if (!academyId || !MONTH_PATTERN.test(serviceMonth)) {
            return Response.json({ success: false, error: 'Invalid payment overview request.' }, { status: 400 });
        }
        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff']);
        const data = await loadStudentPaymentOperationsOverview(actor, serviceMonth);
        return Response.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        console.error('[LMS Payments] Loading failed:', error);
        return Response.json({ success: false, error: 'Payment overview loading failed.' }, { status: 500 });
    }
}

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
