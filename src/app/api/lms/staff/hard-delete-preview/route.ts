import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import { loadStaffHardDeletePreview } from '@/lib/lms/staff-queries';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        const body = await request.json() as { academyId?: string; staffId?: string };
        if (!body.academyId || !body.staffId) {
            return Response.json({ success: false, error: 'Invalid staff hard delete preview request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin']);
        const data = await loadStaffHardDeletePreview(body.academyId, body.staffId);

        return Response.json({ success: true, data });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Staff Hard Delete Preview] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Staff hard delete preview failed.',
        }, { status: 500 });
    }
}
