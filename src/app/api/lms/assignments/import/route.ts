import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { importWorksheetAssignmentForAcademy } from '@/lib/lms/assignment-import';

function parseStringArray(value: FormDataEntryValue | null): string[] {
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
    } catch {
        return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
}

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const form = await request.formData();
        const academyId = String(form.get('academyId') || '');
        const title = String(form.get('title') || '').trim();
        const file = form.get('file');

        if (!academyId || !title || !(file instanceof File)) {
            return Response.json({ success: false, error: 'Invalid worksheet assignment request.' }, { status: 400 });
        }

        const actor = await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        const assignment = await importWorksheetAssignmentForAcademy(
            academyId,
            {
                title,
                description: String(form.get('description') || '').trim() || null,
                dueAt: String(form.get('dueAt') || '').trim() || null,
                context: String(form.get('context') || 'homework'),
                classIds: parseStringArray(form.get('classIds')),
                studentIds: parseStringArray(form.get('studentIds')),
                excludedStudentIds: parseStringArray(form.get('excludedStudentIds')),
                sourceType: 'worksheet',
            },
            file,
            actor,
        );

        return Response.json({ success: true, assignment });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Worksheet Assignment Import] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Worksheet assignment import failed.',
        }, { status: 500 });
    }
}
