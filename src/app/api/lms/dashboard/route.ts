import { authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { loadDashboardDataForContext } from '@/lib/lms/dashboard-queries';

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
        const date = params.get('date') || '';

        if (!academyId || !MONTH_PATTERN.test(serviceMonth) || !DATE_PATTERN.test(date)) {
            return noStoreJson({ success: false, error: 'Invalid dashboard request.' }, { status: 400 });
        }

        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        const data = await loadDashboardDataForContext(actor, serviceMonth, date);

        return noStoreJson({ success: true, data });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Dashboard] Failed:', error);
        return noStoreJson({
            success: false,
            error: error instanceof Error ? error.message : 'Dashboard loading failed.',
        }, { status: 500 });
    }
}
