import { authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { loadStudentAssignmentLearningDetail } from '@/lib/lms/student-queries';

function json(body: unknown, init?: ResponseInit) {
    return Response.json(body, { ...init, headers: { 'Cache-Control': 'no-store', ...init?.headers } });
}

export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const academyId = url.searchParams.get('academyId') || '';
        const studentId = url.searchParams.get('studentId') || '';
        const assignmentId = url.searchParams.get('assignmentId') || '';
        if (!academyId || !studentId || !assignmentId) return json({ success: false, error: 'Invalid assignment learning request.' }, { status: 400 });
        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        return json({ success: true, data: await loadStudentAssignmentLearningDetail(actor, studentId, assignmentId) });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        console.error('[LMS Student Assignment Learning] Failed:', error);
        return json({ success: false, error: error instanceof Error ? error.message : 'Student assignment learning loading failed.' }, { status: 500 });
    }
}
