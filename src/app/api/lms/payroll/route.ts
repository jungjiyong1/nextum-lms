import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createInstructorPaymentForAcademy } from '@/lib/lms/mutations';
import type { CreateInstructorPaymentInput } from '@/features/lms/types';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; input?: CreateInstructorPaymentInput };
        if (!body.academyId || !body.input) {
            return Response.json({ success: false, error: 'Invalid payroll request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        await createInstructorPaymentForAcademy(body.academyId, body.input);

        return Response.json({ success: true });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Payroll] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Payroll creation failed.',
        }, { status: 500 });
    }
}
