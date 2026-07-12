import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertDurableClassOperatorAccess } from '@/lib/lms/class-access';
import { loadClassMemberCandidates } from '@/lib/lms/class-queries';
import { changeClassMembersForAcademy } from '@/lib/lms/mutations';
import type { ClassMembershipChangeInput } from '@/features/lms/types';
import { ApiContractError } from '@/lib/lms/api-contracts';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

function noStoreJson(body: unknown, init?: ResponseInit) {
    return Response.json(body, {
        ...init,
        headers: { 'Cache-Control': 'no-store', ...init?.headers },
    });
}

export async function GET(request: Request) {
    try {
        const params = new URL(request.url).searchParams;
        const academyId = params.get('academyId') || '';
        const classId = params.get('classId') || '';
        if (!academyId || !classId) {
            return noStoreJson({ success: false, error: 'Invalid class member request.' }, { status: 400 });
        }
        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        await assertDurableClassOperatorAccess(actor, { classId });
        const data = await loadClassMemberCandidates(actor, classId, params.get('q'));
        return noStoreJson({ success: true, data });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        if (error instanceof ApiContractError) {
            return noStoreJson({ success: false, error: error.apiError }, { status: 400 });
        }
        console.error('[LMS Class Members] Failed:', error);
        return noStoreJson({ success: false, error: 'Class member loading failed.' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; input?: ClassMembershipChangeInput };
        if (!body.academyId || !body.input?.classId || !body.input.effectiveDate || !body.input.changes?.length) {
            return mutationError('INVALID_CLASS_MEMBER_REQUEST', 'Invalid class member request.', { request });
        }
        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        await assertDurableClassOperatorAccess(actor, { classId: body.input.classId });
        const data = await changeClassMembersForAcademy(body.academyId, body.input);
        return mutationSuccess(data, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        console.error('[LMS Class Members] Failed:', error);
        return mutationException(error, 'CLASS_MEMBER_OPERATION_FAILED', 'Class member update failed.', { request });
    }
}
