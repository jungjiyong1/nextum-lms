import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createExpenseForAcademy } from '@/lib/lms/mutations';
import type { CreateExpenseInput } from '@/features/lms/types';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

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
