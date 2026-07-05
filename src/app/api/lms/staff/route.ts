import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createStaffForAcademy, updateStaffForAcademy } from '@/lib/lms/mutations';
import type { CreateStaffInput, UpdateStaffInput } from '@/features/lms/types';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; staffId?: string; input?: CreateStaffInput | UpdateStaffInput };
        if (!body.academyId || !body.input) {
            return Response.json({ success: false, error: 'Invalid staff request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin']);
        if (body.staffId) {
            await updateStaffForAcademy(body.academyId, body.staffId, body.input as UpdateStaffInput);
        } else {
            await createStaffForAcademy(body.academyId, body.input as CreateStaffInput);
        }

        return Response.json({ success: true });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Staff] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Staff creation failed.',
        }, { status: 500 });
    }
}
