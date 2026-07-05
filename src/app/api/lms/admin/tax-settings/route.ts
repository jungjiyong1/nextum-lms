import { assertRecentAuth, assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { updateTaxSettingsForAcademy } from '@/lib/lms/admin-operations';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; settings?: Record<string, unknown> };
        if (!body.academyId || !body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
            return Response.json({ success: false, error: 'Invalid settings payload.' }, { status: 400 });
        }

        const admin = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin']);
        assertRecentAuth(admin);
        await updateTaxSettingsForAcademy(body.settings, body.academyId);

        return Response.json({ success: true });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Admin Tax Settings] Failed:', error);
        return Response.json({ success: false, error: 'Failed to save tax settings.' }, { status: 500 });
    }
}
