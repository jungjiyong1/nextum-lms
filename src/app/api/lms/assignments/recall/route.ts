import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { recallLearningAssignmentForAcademy } from '@/lib/lms/mutations';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as {
            academyId?: string;
            assignmentId?: string;
        };
        if (!body.academyId || !body.assignmentId) {
            return Response.json({ success: false, error: 'Invalid assignment recall request.' }, { status: 400 });
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        await recallLearningAssignmentForAcademy(actor, body.assignmentId);

        return Response.json({ success: true });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Assignment Recall] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Assignment recall failed.',
        }, { status: 500 });
    }
}
