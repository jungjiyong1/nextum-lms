import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import { assertReauthCookie } from '@/lib/lms/reauth';
import { hardDeleteStaffForAcademy } from '@/lib/lms/staff-admin';
import { loadStaffHardDeletePreview } from '@/lib/lms/staff-queries';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        const body = await request.json() as { academyId?: string; staffId?: string; confirmName?: string };
        if (!body.academyId || !body.staffId || !body.confirmName) {
            return Response.json({ success: false, error: 'Invalid staff hard delete request.' }, { status: 400 });
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin']);
        await assertReauthCookie({ userId: actor.userId, academyId: body.academyId });

        const preview = await loadStaffHardDeletePreview(body.academyId, body.staffId);
        if (body.confirmName.trim() !== preview.staffName) {
            return Response.json({ success: false, error: 'Staff name confirmation does not match.' }, { status: 400 });
        }
        if (!preview.canHardDelete) {
            return Response.json({ success: false, error: 'This staff member has historical records and can only be archived.' }, { status: 409 });
        }

        const result = await hardDeleteStaffForAcademy(body.academyId, body.staffId, actor);

        return Response.json({ success: true, data: result });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Staff Hard Delete] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Staff hard delete failed.',
        }, { status: 500 });
    }
}
