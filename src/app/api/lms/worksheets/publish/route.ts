import { randomUUID } from 'node:crypto';

import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';
import { assertLmsRoleForAcademy, assertSameOrigin, authErrorResponse } from '@/lib/lms/auth';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import { publishWorksheetDraft, WorksheetInputError } from '@/lib/lms/worksheet-mutations';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        const body = await request.json() as { academyId?: string; draftId?: string; title?: string };
        if (!body.academyId || !body.draftId) {
            return mutationError(
                'INVALID_WORKSHEET_PUBLISH_REQUEST',
                'Invalid worksheet publish request.',
                { request },
            );
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, [
            'owner', 'admin', 'staff', 'teacher', 'instructor',
        ]);
        const result = await publishWorksheetDraft(actor, {
            draftId: body.draftId,
            title: body.title,
        });

        return mutationSuccess(result, {
            request,
            invalidation: { eventId: randomUUID(), domains: ['worksheets', 'assignments'] },
        });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        if (error instanceof WorksheetInputError) {
            return mutationError('INVALID_WORKSHEET_PUBLISH', error.message, { request });
        }

        console.error('[LMS Worksheet Publish] Failed:', error);
        return mutationException(error, 'WORKSHEET_PUBLISH_FAILED', 'Worksheet publish failed.', { request });
    }
}
