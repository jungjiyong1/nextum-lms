import { authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { loadAccountingOperationsOverview } from '@/lib/lms/accounting-queries';

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function noStoreJson(body: unknown, init?: ResponseInit) {
    return Response.json(body, {
        ...init,
        headers: {
            'Cache-Control': 'no-store',
            ...init?.headers,
        },
    });
}

export async function GET(request: Request) {
    try {
        const params = new URL(request.url).searchParams;
        const academyId = params.get('academyId') || '';
        const serviceMonth = params.get('serviceMonth') || '';

        if (!academyId || !MONTH_PATTERN.test(serviceMonth)) {
            return noStoreJson({ success: false, error: 'Invalid accounting request.' }, { status: 400 });
        }

        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff']);
        const data = await loadAccountingOperationsOverview(actor, serviceMonth);

        return noStoreJson({ success: true, data });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Accounting] Failed:', error);
        return noStoreJson({
            success: false,
            error: error instanceof Error ? error.message : 'Accounting loading failed.',
        }, { status: 500 });
    }
}
