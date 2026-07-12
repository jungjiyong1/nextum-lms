import { authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { loadStudentLearningClassContext } from '@/lib/lms/student-queries';

function json(body: unknown, init?: ResponseInit) {
    return Response.json(body, { ...init, headers: { 'Cache-Control': 'no-store', ...init?.headers } });
}

export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const academyId = url.searchParams.get('academyId') || '';
        const studentId = url.searchParams.get('studentId') || '';
        const classId = url.searchParams.get('classId') || '';
        if (!academyId || !studentId || !classId) return json({ success: false, error: 'Invalid learning context request.' }, { status: 400 });
        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        return json({ success: true, data: await loadStudentLearningClassContext(actor, studentId, classId) });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        console.error('[LMS Student Learning Context] Failed:', error);
        return json({ success: false, error: error instanceof Error ? error.message : 'Student learning context loading failed.' }, { status: 500 });
    }
}
