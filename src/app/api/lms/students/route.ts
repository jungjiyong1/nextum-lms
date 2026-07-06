import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createStudentForAcademy, updateStudentForAcademy } from '@/lib/lms/mutations';
import { loadStudentOperationsOverview } from '@/lib/lms/student-queries';
import type { CreateStudentInput, UpdateStudentInput } from '@/features/lms/types';

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
        const academyId = new URL(request.url).searchParams.get('academyId') || '';
        if (!academyId) {
            return noStoreJson({ success: false, error: 'Invalid student overview request.' }, { status: 400 });
        }

        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        const data = await loadStudentOperationsOverview(actor);

        return noStoreJson({ success: true, data });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

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
            return Response.json({ success: false, error: 'Invalid student request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        if (body.studentId) {
            await updateStudentForAcademy(body.academyId, body.studentId, body.input as UpdateStudentInput);
        } else {
            const data = await createStudentForAcademy(body.academyId, body.input as CreateStudentInput);
            return Response.json({ success: true, data });
        }

        return Response.json({ success: true });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Students] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Student creation failed.',
        }, { status: 500 });
    }
}
