import { authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { loadClassOperationsOverview } from '@/lib/lms/class-queries';

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
        const startDate = params.get('startDate') || '';
        const endDate = params.get('endDate') || '';

        if (!academyId || !DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate) || startDate > endDate) {
            return noStoreJson({ success: false, error: 'Invalid class overview request.' }, { status: 400 });
        }

        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        const data = await loadClassOperationsOverview(actor, startDate, endDate);

        return noStoreJson({ success: true, data });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Class Overview] Failed:', error);
        return noStoreJson({
            success: false,
            error: error instanceof Error ? error.message : 'Class overview loading failed.',
        }, { status: 500 });
    }
}
