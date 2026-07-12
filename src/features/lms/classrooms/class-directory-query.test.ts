import { describe, expect, it } from 'vitest';

import type { ClassSummary } from '../types';
import {
  CLASS_DIRECTORY_MAX_RENDERED,
  CLASS_DIRECTORY_PAGE_SIZE,
  classDirectoryHref,
  classMatchesDirectoryQuery,
  compareClassDirectoryRows,
  decodeClassDirectoryCursor,
  encodeClassDirectoryCursor,
  parseClassDirectoryQuery,
} from './class-directory-query';

function classroom(overrides: Partial<ClassSummary>): ClassSummary {
  return {
    id: 'class-1',
    name: '중2 수학 A',
    grade: '중2',
    active: true,
    status: 'active',
    color: null,
    capacity: null,
    defaultInstructorId: 'staff-1',
    defaultClassroomId: null,
    courseTitle: null,
    instructorName: '김강사',
    classroomName: null,
    studentCount: 0,
    weakTypeCount: 0,
    avgTypeScore: null,
    lastLearningAt: null,
    ...overrides,
  };
}

describe('class directory query state', () => {
  it('restores filters from the URL and corrects invalid statuses', () => {
    expect(parseClassDirectoryQuery(new URLSearchParams(
      'q=%EC%88%98%ED%95%99&grade=%EC%A4%912&subject=subject-1&instructor=staff-1&status=archived&cursor=v2%3A%25EC%2588%2598%25ED%2595%2599%3A123e4567-e89b-12d3-a456-426614174000',
    ))).toEqual({
      q: '수학',
      grade: '중2',
      subject: 'subject-1',
      instructor: 'staff-1',
      status: 'archived',
      cursor: 'v2:%EC%88%98%ED%95%99:123e4567-e89b-12d3-a456-426614174000',
    });
    expect(parseClassDirectoryQuery(new URLSearchParams('status=unknown')).status).toBe('active');
  });

  it('writes only meaningful filters and resets to the canonical directory URL', () => {
    expect(classDirectoryHref({ q: '수학', grade: '중2', status: 'all' }))
      .toBe('/classrooms?q=%EC%88%98%ED%95%99&grade=%EC%A4%912&status=all');
    expect(classDirectoryHref({})).toBe('/classrooms');
  });

  it('round-trips valid cursors and rejects malformed cursors', () => {
    const cursor = { name: '중2 수학:A', id: '123e4567-e89b-12d3-a456-426614174000' };
    expect(decodeClassDirectoryCursor(encodeClassDirectoryCursor(cursor))).toEqual(cursor);
    expect(decodeClassDirectoryCursor('120')).toBeNull();
    expect(decodeClassDirectoryCursor('v2::not-a-uuid')).toBeNull();
  });

  it('keeps each response and rendered window bounded for large academies', () => {
    expect(CLASS_DIRECTORY_PAGE_SIZE).toBeLessThanOrEqual(100);
    expect(CLASS_DIRECTORY_MAX_RENDERED).toBeLessThanOrEqual(180);
    expect(CLASS_DIRECTORY_MAX_RENDERED).toBeGreaterThanOrEqual(CLASS_DIRECTORY_PAGE_SIZE);
  });

  it('filters by normalized subject, target grade, instructor and status', () => {
    const row = classroom({
      subjectId: 'subject-math',
      subjectName: '수학',
      targetGrades: ['중2', '중3'],
      primaryTargetGrade: '중2',
      instructorIds: ['staff-1', 'staff-2'],
      instructors: [{ id: 'staff-1', name: '김강사' }, { id: 'staff-2', name: '이강사' }],
    });
    expect(classMatchesDirectoryQuery(row, {
      q: '김강사',
      grade: '중3',
      subject: 'subject-math',
      instructor: 'staff-1',
      status: 'active',
      cursor: '',
    })).toBe(true);
    expect(classMatchesDirectoryQuery(row, {
      q: '이강사',
      grade: '',
      subject: '',
      instructor: 'staff-2',
      status: 'active',
      cursor: '',
    })).toBe(true);
  });

  it('sorts by target grade, then subject and class name', () => {
    const rows = [
      classroom({ id: '3', name: 'B', primaryTargetGrade: null, grade: null, subjectName: null }),
      classroom({ id: '2', name: 'B', primaryTargetGrade: '고1', subjectName: '수학' }),
      classroom({ id: '1', name: 'A', primaryTargetGrade: '중2', subjectName: '영어' }),
    ];
    expect(rows.sort(compareClassDirectoryRows).map((row) => row.id)).toEqual(['1', '2', '3']);
  });
});
