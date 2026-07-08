import { authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { loadStaffDetail } from '@/lib/lms/staff-queries';

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
        const staffId = params.get('staffId') || '';
        const section = params.get('section') || 'full';
        const serviceMonth = params.get('serviceMonth') || '';
        if (!academyId || !staffId || (serviceMonth && !MONTH_PATTERN.test(serviceMonth))) {
            return noStoreJson({ success: false, error: 'Invalid staff detail request.' }, { status: 400 });
        }

        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        const data = await loadStaffDetail(actor, staffId, section, serviceMonth || undefined);

        return noStoreJson({ success: true, data });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Staff Detail] Failed:', error);
        return noStoreJson({
            success: false,
            error: error instanceof Error ? error.message : 'Staff detail loading failed.',
        }, { status: 500 });
    }
}
