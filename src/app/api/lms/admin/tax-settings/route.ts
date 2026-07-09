import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertReauthCookie } from '@/lib/lms/reauth';
import { recordAdminAction } from '@/lib/lms/audit';
import { updateTaxSettingsForAcademy } from '@/lib/lms/admin-operations';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        const body = await request.json() as { academyId?: string; settings?: Record<string, unknown> };
        if (!body.academyId || !body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
            return mutationError('INVALID_TAX_SETTINGS', 'Invalid settings payload.', { request });
        }

        const admin = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin']);
        await assertReauthCookie({ userId: admin.userId, academyId: body.academyId });
        await updateTaxSettingsForAcademy(body.settings, body.academyId);
        await recordAdminAction({
            academyId: body.academyId,
            actorPersonId: admin.personId,
            action: 'lms.admin.tax_settings.update',
            target: 'tax_settings',
            payload: {
                keys: Object.keys(body.settings).sort(),
            },
        });

        return mutationSuccess(null, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Admin Tax Settings] Failed:', error);
        return mutationException(error, 'TAX_SETTINGS_UPDATE_FAILED', 'Failed to save tax settings.', { request });
    }
}
