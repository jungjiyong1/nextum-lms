import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { generateMonthlyInvoicesForAcademy } from '@/lib/lms/mutations';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; serviceMonth?: string };
        if (!body.academyId || !body.serviceMonth) {
            return Response.json({ success: false, error: 'Invalid billing request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        await generateMonthlyInvoicesForAcademy(body.academyId, body.serviceMonth);

        return Response.json({ success: true });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Billing Generate] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Billing generation failed.',
        }, { status: 500 });
    }
}
