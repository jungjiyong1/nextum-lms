import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createBookForAcademy, updateBookForAcademy } from '@/lib/lms/mutations';
import type { CreateBookInput, UpdateBookInput } from '@/features/lms/types';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as {
            academyId?: string;
            bookId?: string;
            input?: CreateBookInput | UpdateBookInput;
        };
        if (!body.academyId || !body.input) {
            return mutationError('INVALID_BOOK_REQUEST', 'Invalid book request.', { request });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        if (body.bookId) {
            await updateBookForAcademy(body.academyId, body.bookId, body.input as UpdateBookInput);
        } else {
            await createBookForAcademy(body.academyId, body.input as CreateBookInput);
        }

        return mutationSuccess(null, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Books] Failed:', error);
        return mutationException(error, 'BOOK_OPERATION_FAILED', 'Book operation failed.', { request });
    }
}
