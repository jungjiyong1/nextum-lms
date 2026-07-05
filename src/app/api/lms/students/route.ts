import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createStudentForAcademy } from '@/lib/lms/mutations';
import type { CreateStudentInput } from '@/features/lms/types';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; input?: CreateStudentInput };
        if (!body.academyId || !body.input) {
            return Response.json({ success: false, error: 'Invalid student request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        await createStudentForAcademy(body.academyId, body.input);

        return Response.json({ success: true });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Students] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Student creation failed.',
        }, { status: 500 });
    }
}
