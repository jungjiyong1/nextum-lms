import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertReauthCookie } from '@/lib/lms/reauth';
import { recordAdminAction } from '@/lib/lms/audit';
import { assertAdminConfirmToken } from '@/lib/lms/admin-confirm';
import { resetLmsData, type ResetTarget } from '@/lib/lms/admin-operations';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

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
        assertCsrfToken(request);
        let body: ResetRequestBody;
        try {
            body = await request.json() as ResetRequestBody;
        } catch {
            return mutationError('INVALID_RESET_REQUEST', 'Invalid reset request.', { request });
        }
        const { academyId, target, confirmToken } = body;

        if (!academyId || !target || !resetTargets.has(target)) {
            return mutationError('INVALID_RESET_TARGET', 'Invalid reset target.', { request });
        }
        if (!confirmToken) {
            return mutationError('RESET_CONFIRMATION_REQUIRED', 'Reset confirmation is required.', { request, status: 403 });
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
            return mutationError('RESET_CONFIRMATION_REQUIRED', 'Reset confirmation is required.', { request, status: 403 });
        }

        const summary = await resetLmsData(target, academyId);
        await recordAdminAction({
            academyId,
            actorPersonId: admin.personId,
            action: 'lms.admin.reset',
            target,
            payload: summary,
        });

        return mutationSuccess(summary, { request, aliases: { reset: summary } });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Admin Reset] Failed:', error);
        return mutationException(error, 'RESET_FAILED', 'Reset failed.', { request });
    }
}
