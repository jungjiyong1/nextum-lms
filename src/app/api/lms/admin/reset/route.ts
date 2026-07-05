import { authErrorResponse, assertLmsAdminRequest } from '@/lib/lms/auth';
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
        const admin = await assertLmsAdminRequest(request, { requireRecentAuth: true });
        const { target } = await request.json() as { target?: ResetTarget };

        if (!target || !resetTargets.has(target)) {
            return Response.json({ success: false, error: 'Invalid reset target.' }, { status: 400 });
        }

        await resetLmsData(target, admin.academyId);

        return Response.json({ success: true });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Admin Reset] Failed:', error);
        return Response.json({ success: false, error: 'Reset failed.' }, { status: 500 });
    }
}
