import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertReauthCookie } from '@/lib/lms/reauth';
import { resetLmsData, type ResetTarget } from '@/lib/lms/admin-operations';

const resetTargets = new Set<ResetTarget>([
    'classrooms',
    'classes',
    'lessons',
    'schedules',
    'students',
    'instructors',
    'courses',
    'enrollments',
    'accounting',
    'all',
]);

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const { academyId, target } = await request.json() as { academyId?: string; target?: ResetTarget };

        if (!academyId || !target || !resetTargets.has(target)) {
            return Response.json({ success: false, error: 'Invalid reset target.' }, { status: 400 });
        }

        const admin = await assertLmsRoleForAcademy(academyId, ['owner', 'admin']);
        await assertReauthCookie({ userId: admin.userId, academyId });
        await resetLmsData(target, academyId);

        return Response.json({ success: true });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Admin Reset] Failed:', error);
        return Response.json({ success: false, error: 'Reset failed.' }, { status: 500 });
    }
}
