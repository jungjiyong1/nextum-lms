import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertReauthCookie } from '@/lib/lms/reauth';
import { recordAdminAction } from '@/lib/lms/audit';
import { assertAdminConfirmToken } from '@/lib/lms/admin-confirm';
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

interface ResetRequestBody {
    academyId?: string;
    target?: ResetTarget;
    confirmToken?: string;
}

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        let body: ResetRequestBody;
        try {
            body = await request.json() as ResetRequestBody;
        } catch {
            return Response.json({ success: false, error: 'Invalid reset request.' }, { status: 400 });
        }
        const { academyId, target, confirmToken } = body;

        if (!academyId || !target || !resetTargets.has(target)) {
            return Response.json({ success: false, error: 'Invalid reset target.' }, { status: 400 });
        }
        if (!confirmToken) {
            return Response.json({ success: false, error: 'Reset confirmation is required.' }, { status: 403 });
        }

        const admin = await assertLmsRoleForAcademy(academyId, ['owner', 'admin']);
        await assertReauthCookie({ userId: admin.userId, academyId });
        try {
            assertAdminConfirmToken(confirmToken, {
                userId: admin.userId,
                academyId,
                action: 'lms.admin.reset',
                target,
            });
        } catch {
            return Response.json({ success: false, error: 'Reset confirmation is required.' }, { status: 403 });
        }

        const summary = await resetLmsData(target, academyId);
        await recordAdminAction({
            academyId,
            actorPersonId: admin.personId,
            action: 'lms.admin.reset',
            target,
            payload: summary,
        });

        return Response.json({ success: true, reset: summary });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Admin Reset] Failed:', error);
        return Response.json({ success: false, error: 'Reset failed.' }, { status: 500 });
    }
}
