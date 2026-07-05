import { authErrorResponse, assertLmsAdminRequest } from '@/lib/lms/auth';
import { updateTaxSettingsForAcademy } from '@/lib/lms/admin-operations';

export async function POST(request: Request) {
    try {
        const admin = await assertLmsAdminRequest(request, { requireRecentAuth: true });
        const body = await request.json() as { settings?: Record<string, unknown> };
        if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
            return Response.json({ success: false, error: 'Invalid settings payload.' }, { status: 400 });
        }

        await updateTaxSettingsForAcademy(body.settings, admin.academyId);

        return Response.json({ success: true });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Admin Tax Settings] Failed:', error);
        return Response.json({ success: false, error: 'Failed to save tax settings.' }, { status: 500 });
    }
}
