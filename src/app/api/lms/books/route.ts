import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createBookForAcademy, updateBookForAcademy } from '@/lib/lms/mutations';
import type { CreateBookInput, UpdateBookInput } from '@/features/lms/types';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as {
            academyId?: string;
            bookId?: string;
            input?: CreateBookInput | UpdateBookInput;
        };
        if (!body.academyId || !body.input) {
            return Response.json({ success: false, error: 'Invalid book request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff']);
        if (body.bookId) {
            await updateBookForAcademy(body.academyId, body.bookId, body.input as UpdateBookInput);
        } else {
            await createBookForAcademy(body.academyId, body.input as CreateBookInput);
        }

        return Response.json({ success: true });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Books] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Book operation failed.',
        }, { status: 500 });
    }
}
