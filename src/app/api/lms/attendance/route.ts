import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertAssignedClassAccess } from '@/lib/lms/class-access';
import { recordAttendanceBatchForAcademy, recordAttendanceForAcademy } from '@/lib/lms/mutations';
import type { BatchAttendanceInput, RecordAttendanceInput } from '@/features/lms/types';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; input?: RecordAttendanceInput; batch?: BatchAttendanceInput };
        if (!body.academyId || (!body.input && !body.batch)) {
            return mutationError('INVALID_ATTENDANCE_REQUEST', 'Invalid attendance request.', { request });
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        const target = body.batch || body.input;
        await assertAssignedClassAccess(actor, target!);
        if (body.batch) {
            const data = await recordAttendanceBatchForAcademy(body.academyId, body.batch, actor);
            return mutationSuccess(data, { request });
        }
        await recordAttendanceForAcademy(body.academyId, body.input!);

        return mutationSuccess(null, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Attendance] Failed:', error);
        return mutationException(error, 'ATTENDANCE_RECORDING_FAILED', 'Attendance recording failed.', { request });
    }
}
