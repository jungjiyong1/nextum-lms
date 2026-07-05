import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createStudentInvitationForAcademy } from '@/lib/lms/mutations';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: string; studentId?: string };
        if (!body.academyId || !body.studentId) {
            return Response.json({ success: false, error: 'Invalid invitation request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        const invite = await createStudentInvitationForAcademy(body.academyId, body.studentId);

        return Response.json({ success: true, invite });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Invitations Issue] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Invitation creation failed.',
        }, { status: 500 });
    }
}
