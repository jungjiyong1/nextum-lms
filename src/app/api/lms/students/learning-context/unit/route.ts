import { authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { loadStudentLearningUnitDetail } from '@/lib/lms/student-queries';

function json(body: unknown, init?: ResponseInit) {
    return Response.json(body, { ...init, headers: { 'Cache-Control': 'no-store', ...init?.headers } });
}

export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const academyId = url.searchParams.get('academyId') || '';
        const studentId = url.searchParams.get('studentId') || '';
        const classId = url.searchParams.get('classId') || '';
        const unitId = url.searchParams.get('unitId');
        if (!academyId || !studentId || !classId || !unitId) return json({ success: false, error: 'Invalid unit learning request.' }, { status: 400 });
        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        return json({ success: true, data: await loadStudentLearningUnitDetail(actor, studentId, classId, unitId) });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        console.error('[LMS Student Unit Learning] Failed:', error);
        return json({ success: false, error: error instanceof Error ? error.message : 'Student unit learning loading failed.' }, { status: 500 });
    }
}
