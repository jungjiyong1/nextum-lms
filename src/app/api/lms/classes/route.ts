import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createClassForAcademy } from '@/lib/lms/mutations';
import type { CreateClassInput } from '@/features/lms/types';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; input?: CreateClassInput };
        if (!body.academyId || !body.input) {
            return Response.json({ success: false, error: 'Invalid class request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        await createClassForAcademy(body.academyId, body.input);

        return Response.json({ success: true });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Classes] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Class creation failed.',
        }, { status: 500 });
    }
}
