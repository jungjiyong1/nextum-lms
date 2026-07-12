import { authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { loadStudentLearningTypeEvidence } from '@/lib/lms/student-queries';

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
        const typeId = url.searchParams.get('typeId');
        if (!academyId || !studentId || !classId || !unitId || !typeId) return json({ success: false, error: 'Invalid learning evidence request.' }, { status: 400 });
        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        return json({ success: true, data: await loadStudentLearningTypeEvidence(actor, studentId, classId, typeId, unitId) });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        console.error('[LMS Student Learning Evidence] Failed:', error);
        return json({ success: false, error: error instanceof Error ? error.message : 'Student learning evidence loading failed.' }, { status: 500 });
    }
}
