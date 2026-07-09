import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertReauthCookie } from '@/lib/lms/reauth';
import { createAdminConfirmToken } from '@/lib/lms/admin-confirm';
import type { ResetTarget } from '@/lib/lms/admin-operations';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

const RESET_CONFIRM_TEXT = '초기화';

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

interface ResetConfirmRequestBody {
    academyId?: string;
    target?: ResetTarget;
    confirmText?: string;
}

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        let body: ResetConfirmRequestBody;
        try {
            body = await request.json() as ResetConfirmRequestBody;
        } catch {
            return mutationError('INVALID_RESET_CONFIRMATION', 'Invalid reset confirmation.', { request });
        }
        const { academyId, target, confirmText } = body;

        if (!academyId || !target || !resetTargets.has(target) || confirmText?.trim() !== RESET_CONFIRM_TEXT) {
            return mutationError('INVALID_RESET_CONFIRMATION', 'Invalid reset confirmation.', { request });
        }

        const admin = await assertLmsRoleForAcademy(academyId, ['owner', 'admin']);
        await assertReauthCookie({ userId: admin.userId, academyId });

        const { token, expiresAt } = createAdminConfirmToken({
            userId: admin.userId,
            academyId,
            action: 'lms.admin.reset',
            target,
        });

        return mutationSuccess({ confirmToken: token, expiresAt }, {
            request,
            aliases: { confirmToken: token, expiresAt },
        });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Admin Reset Confirm] Failed:', error);
        return mutationException(error, 'RESET_CONFIRMATION_FAILED', 'Reset confirmation failed.', { request });
    }
}
