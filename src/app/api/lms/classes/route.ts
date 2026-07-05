import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createClassForAcademy, updateClassForAcademy } from '@/lib/lms/mutations';
import type { CreateClassInput, UpdateClassInput } from '@/features/lms/types';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; classId?: string; input?: CreateClassInput | UpdateClassInput };
        if (!body.academyId || !body.input) {
            return Response.json({ success: false, error: 'Invalid class request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        if (body.classId) {
            await updateClassForAcademy(body.academyId, body.classId, body.input as UpdateClassInput);
        } else {
            await createClassForAcademy(body.academyId, body.input as CreateClassInput);
        }

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
