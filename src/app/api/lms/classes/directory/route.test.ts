import { beforeEach, describe, expect, it, vi } from 'vitest';

const { assertRole, authErrorResponse, loadDirectory } = vi.hoisted(() => ({
  assertRole: vi.fn(),
  authErrorResponse: vi.fn<(error: unknown) => Response | null>(() => null),
  loadDirectory: vi.fn(),
}));

vi.mock('@/lib/lms/auth', () => ({
  assertLmsRoleForAcademy: assertRole,
  authErrorResponse,
}));

vi.mock('@/lib/lms/class-queries', () => ({ loadClassDirectory: loadDirectory }));

import { GET } from './route';

const ACADEMY_ID = '00000000-0000-4000-8000-000000000001';
const INSTRUCTOR_ID = '00000000-0000-4000-8000-000000000002';
const CURSOR = 'v2:%EC%A4%912%20%EC%88%98%ED%95%99:00000000-0000-4000-8000-000000000003';
const actor = { academyId: ACADEMY_ID, userId: 'user-1', personId: 'person-1', role: 'instructor' };

describe('class directory route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    assertRole.mockResolvedValue(actor);
    authErrorResponse.mockReturnValue(null);
    loadDirectory.mockResolvedValue({ classes: [], facets: {}, nextCursor: null, hasMore: false, totalCount: 0 });
  });

  it('passes restored search filters and cursor through the assigned-class authorization boundary', async () => {
    const response = await GET(new Request(
      `http://localhost/api/lms/classes/directory?academyId=${ACADEMY_ID}&q=%EC%88%98%ED%95%99&grade=%EC%A4%912&subject=subject-1&instructor=${INSTRUCTOR_ID}&status=all&cursor=${encodeURIComponent(CURSOR)}&limit=60`,
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(assertRole).toHaveBeenCalledWith(
      ACADEMY_ID,
      ['owner', 'admin', 'staff', 'teacher', 'instructor'],
    );
    expect(loadDirectory).toHaveBeenCalledWith(actor, {
      q: '수학',
      grade: '중2',
      subject: 'subject-1',
      instructor: INSTRUCTOR_ID,
      status: 'all',
      cursor: CURSOR,
    }, { limit: 60, classId: null });
  });

  it('rejects unsafe page sizes before authorization', async () => {
    const response = await GET(new Request(
      `http://localhost/api/lms/classes/directory?academyId=${ACADEMY_ID}&limit=1000`,
    ));
    expect(response.status).toBe(400);
    expect(assertRole).not.toHaveBeenCalled();
    expect(loadDirectory).not.toHaveBeenCalled();
  });

  it('rejects malformed class deep-link identifiers before authorization', async () => {
    const response = await GET(new Request(
      `http://localhost/api/lms/classes/directory?academyId=${ACADEMY_ID}&classId=not-a-class`,
    ));
    expect(response.status).toBe(400);
    expect(assertRole).not.toHaveBeenCalled();
  });
});
