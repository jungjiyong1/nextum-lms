import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createClassroomForAcademy, updateClassroomForAcademy } from '@/lib/lms/mutations';
import type { CreateClassroomInput, UpdateClassroomInput } from '@/features/lms/types';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as {
            academyId?: string;
            classroomId?: string;
            input?: CreateClassroomInput | UpdateClassroomInput;
        };
        if (!body.academyId || !body.input) {
            return mutationError('INVALID_CLASSROOM_REQUEST', 'Invalid classroom request.', { request });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        if (body.classroomId) {
            await updateClassroomForAcademy(body.academyId, body.classroomId, body.input as UpdateClassroomInput);
        } else {
            await createClassroomForAcademy(body.academyId, body.input as CreateClassroomInput);
        }

        return mutationSuccess(null, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Classrooms] Failed:', error);
        return mutationException(error, 'CLASSROOM_OPERATION_FAILED', 'Classroom operation failed.', { request });
    }
}
