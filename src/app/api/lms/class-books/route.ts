import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { setClassBookForAcademy } from '@/lib/lms/mutations';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as {
            academyId?: string;
            classId?: string;
            bookId?: string;
            active?: boolean;
        };
        if (!body.academyId || !body.classId || !body.bookId) {
            return Response.json({ success: false, error: 'Invalid class book request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        await setClassBookForAcademy(body.academyId, body.classId, body.bookId, body.active ?? true);

        return Response.json({ success: true });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Class Books] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Class book assignment failed.',
        }, { status: 500 });
    }
}
