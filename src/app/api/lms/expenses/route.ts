import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createExpenseForAcademy } from '@/lib/lms/mutations';
import type { CreateExpenseInput } from '@/features/lms/types';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; input?: CreateExpenseInput };
        if (!body.academyId || !body.input) {
            return Response.json({ success: false, error: 'Invalid expense request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        await createExpenseForAcademy(body.academyId, body.input);

        return Response.json({ success: true });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Expenses] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Expense creation failed.',
        }, { status: 500 });
    }
}
