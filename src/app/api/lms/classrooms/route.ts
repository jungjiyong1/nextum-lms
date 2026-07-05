import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createClassroomForAcademy, updateClassroomForAcademy } from '@/lib/lms/mutations';
import type { CreateClassroomInput, UpdateClassroomInput } from '@/features/lms/types';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as {
            academyId?: string;
            classroomId?: string;
            input?: CreateClassroomInput | UpdateClassroomInput;
        };
        if (!body.academyId || !body.input) {
            return Response.json({ success: false, error: 'Invalid classroom request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        if (body.classroomId) {
            await updateClassroomForAcademy(body.academyId, body.classroomId, body.input as UpdateClassroomInput);
        } else {
            await createClassroomForAcademy(body.academyId, body.input as CreateClassroomInput);
        }

        return Response.json({ success: true });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Classrooms] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Classroom operation failed.',
        }, { status: 500 });
    }
}
