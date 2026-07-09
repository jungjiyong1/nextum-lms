import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { setClassBookForAcademy } from '@/lib/lms/mutations';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

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
            return mutationError('INVALID_CLASS_BOOK_REQUEST', 'Invalid class book request.', { request });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        await setClassBookForAcademy(body.academyId, body.classId, body.bookId, body.active ?? true);

        return mutationSuccess(null, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Class Books] Failed:', error);
        return mutationException(error, 'CLASS_BOOK_ASSIGNMENT_FAILED', 'Class book assignment failed.', { request });
    }
}
