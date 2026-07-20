import { randomUUID } from 'node:crypto';

import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';
import { assertLmsRoleForAcademy, assertSameOrigin, authErrorResponse } from '@/lib/lms/auth';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import { WorksheetInputError } from '@/lib/lms/worksheet-mutations';
import { renderWorksheetDraft } from '@/lib/lms/worksheet-render';

// 이미지 정규화와 PDF 합성은 문항 수에 비례해 오래 걸릴 수 있다.
export const maxDuration = 300;

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        const body = await request.json() as { academyId?: string; draftId?: string };
        if (!body.academyId || !body.draftId) {
            return mutationError(
                'INVALID_WORKSHEET_RENDER_REQUEST',
                'Invalid worksheet render request.',
                { request },
            );
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, [
            'owner', 'admin', 'staff', 'teacher', 'instructor',
        ]);
        const result = await renderWorksheetDraft(actor, { draftId: body.draftId });

        return mutationSuccess(result, {
            request,
            invalidation: { eventId: randomUUID(), domains: ['worksheets'] },
        });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        if (error instanceof WorksheetInputError) {
            return mutationError('INVALID_WORKSHEET_RENDER', error.message, { request });
        }

        console.error('[LMS Worksheet Render] Failed:', error);
        return mutationException(error, 'WORKSHEET_RENDER_FAILED', 'Worksheet render failed.', { request });
    }
}
