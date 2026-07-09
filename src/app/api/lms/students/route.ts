import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createStudentForAcademy, updateStudentForAcademy } from '@/lib/lms/mutations';
import { loadStudentOperationsOverview } from '@/lib/lms/student-queries';
import type { CreateStudentInput, UpdateStudentInput } from '@/features/lms/types';
import { ApiContractError } from '@/lib/lms/api-contracts';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

function noStoreJson(body: unknown, init?: ResponseInit) {
    return Response.json(body, {
        ...init,
        headers: {
            'Cache-Control': 'no-store',
            ...init?.headers,
        },
    });
}

export async function GET(request: Request) {
    try {
        const params = new URL(request.url).searchParams;
        const academyId = params.get('academyId') || '';
        if (!academyId) {
            return noStoreJson({ success: false, error: 'Invalid student overview request.' }, { status: 400 });
        }

        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        const data = await loadStudentOperationsOverview(actor, {
            cursor: params.get('cursor'),
            limit: params.get('limit'),
            q: params.get('q'),
            classId: params.get('classId'),
            status: params.get('status'),
            signal: request.signal,
        });

        return noStoreJson({ success: true, data });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        if (error instanceof ApiContractError) {
            return noStoreJson({ success: false, error: error.apiError }, {
                status: 400,
                headers: { 'X-Request-Id': error.apiError.requestId },
            });
        }

        console.error('[LMS Students] Failed:', error);
        return noStoreJson({
            success: false,
            error: error instanceof Error ? error.message : 'Student loading failed.',
        }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; studentId?: string; input?: CreateStudentInput | UpdateStudentInput };
        if (!body.academyId || !body.input) {
            return mutationError('INVALID_STUDENT_REQUEST', 'Invalid student request.', { request });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        if (body.studentId) {
            await updateStudentForAcademy(body.academyId, body.studentId, body.input as UpdateStudentInput);
        } else {
            const data = await createStudentForAcademy(body.academyId, body.input as CreateStudentInput);
            return mutationSuccess(data, { request });
        }

        return mutationSuccess(null, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Students] Failed:', error);
        return mutationException(error, 'STUDENT_OPERATION_FAILED', 'Student creation failed.', { request });
    }
}
