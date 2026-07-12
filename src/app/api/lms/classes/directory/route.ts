import { parseClassDirectoryQuery } from '@/features/lms/classrooms/class-directory-query';
import { authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { loadClassDirectory } from '@/lib/lms/class-queries';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function noStoreJson(body: unknown, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store',
      ...init?.headers,
    },
  });
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const academyId = params.get('academyId') || '';
    const classId = params.get('classId');
    const rawLimit = params.get('limit') || '60';
    const limit = Number(rawLimit);

    const instructor = params.get('instructor');
    if (!UUID_PATTERN.test(academyId) || (classId !== null && !UUID_PATTERN.test(classId))
      || (instructor !== null && instructor !== '' && !UUID_PATTERN.test(instructor))
      || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return noStoreJson({ success: false, error: 'Invalid class directory request.' }, { status: 400 });
    }

    const actor = await assertLmsRoleForAcademy(
      academyId,
      ['owner', 'admin', 'staff', 'teacher', 'instructor'],
    );
    const data = await loadClassDirectory(actor, parseClassDirectoryQuery(params), { limit, classId });
    return noStoreJson({ success: true, data });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('[LMS Class Directory] Failed:', error);
    return noStoreJson({
      success: false,
      error: error instanceof Error ? error.message : 'Class directory loading failed.',
    }, { status: 500 });
  }
}
