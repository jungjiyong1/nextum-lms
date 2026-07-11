import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createExpenseForAcademy } from '@/lib/lms/mutations';
import type { CreateExpenseInput } from '@/features/lms/types';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';
import { loadExpenseOperationsOverview } from '@/lib/lms/accounting-queries';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: Request) {
    try {
        const params = new URL(request.url).searchParams;
        const academyId = params.get('academyId') || '';
        const serviceMonth = params.get('serviceMonth') || '';
        if (!academyId || !MONTH_PATTERN.test(serviceMonth)) {
            return Response.json({ success: false, error: 'Invalid expense overview request.' }, { status: 400 });
        }
        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff']);
        const data = await loadExpenseOperationsOverview(actor, serviceMonth);
        return Response.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        console.error('[LMS Expenses] Loading failed:', error);
        return Response.json({ success: false, error: 'Expense overview loading failed.' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; input?: CreateExpenseInput };
        if (!body.academyId || !body.input) {
            return mutationError('INVALID_EXPENSE_REQUEST', 'Invalid expense request.', { request });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        await createExpenseForAcademy(body.academyId, body.input);

        return mutationSuccess(null, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Expenses] Failed:', error);
        return mutationException(error, 'EXPENSE_CREATION_FAILED', 'Expense creation failed.', { request });
    }
}
