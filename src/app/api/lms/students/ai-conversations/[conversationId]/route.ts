import { authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { loadStudentAiConversationDetail } from '@/lib/lms/student-queries';

function json(body: unknown, init?: ResponseInit) {
    return Response.json(body, { ...init, headers: { 'Cache-Control': 'no-store', ...init?.headers } });
}

export async function GET(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
    try {
        const url = new URL(request.url);
        const academyId = url.searchParams.get('academyId') || '';
        const studentId = url.searchParams.get('studentId') || '';
        const { conversationId } = await params;
        if (!academyId || !studentId || !conversationId) return json({ success: false, error: 'Invalid AI conversation detail request.' }, { status: 400 });
        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        return json({ success: true, data: await loadStudentAiConversationDetail(actor, studentId, conversationId) });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        console.error('[LMS Student AI Conversation Detail] Failed:', error);
        return json({ success: false, error: error instanceof Error ? error.message : 'Student AI conversation detail loading failed.' }, { status: 500 });
    }
}
