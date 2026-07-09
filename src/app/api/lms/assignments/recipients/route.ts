import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import {
    addAssignmentRecipientsForAcademy,
    removeAssignmentRecipientForAcademy,
} from '@/lib/lms/mutations';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as {
            academyId?: string;
            assignmentId?: string;
            studentIds?: string[];
            removeStudentId?: string;
        };
        if (!body.academyId || !body.assignmentId) {
            return mutationError('INVALID_ASSIGNMENT_RECIPIENT_REQUEST', 'Invalid assignment recipient request.', { request });
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        if (body.removeStudentId) {
            await removeAssignmentRecipientForAcademy(actor, body.assignmentId, body.removeStudentId);
        } else {
            await addAssignmentRecipientsForAcademy(actor, body.assignmentId, stringArray(body.studentIds));
        }

        return mutationSuccess(null, { request });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Assignment Recipients] Failed:', error);
        return mutationException(error, 'ASSIGNMENT_RECIPIENT_UPDATE_FAILED', 'Assignment recipient update failed.', { request });
    }
}
