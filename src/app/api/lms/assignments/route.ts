import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createLearningAssignmentForAcademy } from '@/lib/lms/mutations';
import { loadAssignmentManagementData } from '@/lib/lms/assignment-queries';
import type { CreateLearningAssignmentInput } from '@/features/lms/types';

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
            return noStoreJson({ success: false, error: 'Invalid assignment request.' }, { status: 400 });
        }

        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        const data = await loadAssignmentManagementData(actor);
        return noStoreJson({ success: true, data });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Assignments] Failed:', error);
        return noStoreJson({
            success: false,
            error: error instanceof Error ? error.message : 'Assignment loading failed.',
        }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as CreateLearningAssignmentInput & {
            academyId?: string;
        };
        if (!body.academyId) {
            return Response.json({ success: false, error: 'Invalid assignment request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        const assignment = await createLearningAssignmentForAcademy(body.academyId, body);
        return Response.json({ success: true, assignment });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Assignments] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Assignment creation failed.',
        }, { status: 500 });
    }
}
