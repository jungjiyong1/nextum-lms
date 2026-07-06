import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createLearningAssignmentForAcademy } from '@/lib/lms/mutations';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as {
            academyId?: string;
            title?: string;
            description?: string | null;
            bookId?: string | null;
            unitId?: string | null;
            problemIds?: string[];
            classIds?: string[];
            studentIds?: string[];
            dueAt?: string | null;
            context?: string | null;
            sourceType?: 'content_scope' | 'worksheet';
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
