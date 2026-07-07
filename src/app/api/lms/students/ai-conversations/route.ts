import { authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { loadStudentAiConversationFeed } from '@/lib/lms/student-queries';

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
        const url = new URL(request.url);
        const academyId = url.searchParams.get('academyId') || '';
        const studentId = url.searchParams.get('studentId') || '';
        const assignmentId = url.searchParams.get('assignmentId') || null;
        if (!academyId || !studentId) {
            return noStoreJson({ success: false, error: 'Invalid student AI conversation request.' }, { status: 400 });
        }

        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        const data = await loadStudentAiConversationFeed(actor, studentId, assignmentId);
        return noStoreJson({ success: true, data });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Student AI Conversations] Failed:', error);
        return noStoreJson({
            success: false,
            error: error instanceof Error ? error.message : 'Student AI conversations loading failed.',
        }, { status: 500 });
    }
}
