import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertAssignedClassAccess } from '@/lib/lms/class-access';
import { recordAttendanceForAcademy } from '@/lib/lms/mutations';
import type { RecordAttendanceInput } from '@/features/lms/types';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; input?: RecordAttendanceInput };
        if (!body.academyId || !body.input) {
            return mutationError('INVALID_ATTENDANCE_REQUEST', 'Invalid attendance request.', { request });
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        await assertAssignedClassAccess(actor, body.input);
        await recordAttendanceForAcademy(body.academyId, body.input);

        return mutationSuccess(null, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Attendance] Failed:', error);
        return mutationException(error, 'ATTENDANCE_RECORDING_FAILED', 'Attendance recording failed.', { request });
    }
}
