import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertAssignedClassAccess } from '@/lib/lms/class-access';
import { recordAttendanceForAcademy } from '@/lib/lms/mutations';
import type { RecordAttendanceInput } from '@/features/lms/types';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; input?: RecordAttendanceInput };
        if (!body.academyId || !body.input) {
            return Response.json({ success: false, error: 'Invalid attendance request.' }, { status: 400 });
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        await assertAssignedClassAccess(actor, body.input);
        await recordAttendanceForAcademy(body.academyId, body.input);

        return Response.json({ success: true });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Attendance] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Attendance recording failed.',
        }, { status: 500 });
    }
}
