import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import { archiveStaffForAcademy } from '@/lib/lms/staff-admin';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        const body = await request.json() as { academyId?: string; staffId?: string };
        if (!body.academyId || !body.staffId) {
            return Response.json({ success: false, error: 'Invalid staff archive request.' }, { status: 400 });
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin']);
        const result = await archiveStaffForAcademy(body.academyId, body.staffId, actor);

        return Response.json({ success: true, data: result });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Staff Archive] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Staff archive failed.',
        }, { status: 500 });
    }
}
