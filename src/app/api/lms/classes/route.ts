import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createClassForAcademy, updateClassForAcademy } from '@/lib/lms/mutations';
import type { CreateClassInput, UpdateClassInput } from '@/features/lms/types';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; classId?: string; input?: CreateClassInput | UpdateClassInput };
        if (!body.academyId || !body.input) {
            return mutationError('INVALID_CLASS_REQUEST', 'Invalid class request.', { request });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        if (body.classId) {
            await updateClassForAcademy(body.academyId, body.classId, body.input as UpdateClassInput);
        } else {
            await createClassForAcademy(body.academyId, body.input as CreateClassInput);
        }

        return mutationSuccess(null, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Classes] Failed:', error);
        return mutationException(error, 'CLASS_OPERATION_FAILED', 'Class creation failed.', { request });
    }
}
