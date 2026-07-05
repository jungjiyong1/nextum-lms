import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createStudentForAcademy, updateStudentForAcademy } from '@/lib/lms/mutations';
import type { CreateStudentInput, UpdateStudentInput } from '@/features/lms/types';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; studentId?: string; input?: CreateStudentInput | UpdateStudentInput };
        if (!body.academyId || !body.input) {
            return Response.json({ success: false, error: 'Invalid student request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        if (body.studentId) {
            await updateStudentForAcademy(body.academyId, body.studentId, body.input as UpdateStudentInput);
        } else {
            await createStudentForAcademy(body.academyId, body.input as CreateStudentInput);
        }

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
