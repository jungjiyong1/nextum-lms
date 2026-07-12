import type { ClassDirectoryFacetOption, ClassSummary } from '../types';

export const CLASS_DIRECTORY_PAGE_SIZE = 60;
export const CLASS_DIRECTORY_MAX_RENDERED = 180;

export type ClassDirectoryQuery = {
  q: string;
  grade: string;
  subject: string;
  instructor: string;
  status: string;
  cursor: string;
};

export type ClassDirectoryCursor = {
  name: string;
  id: string;
};

export const emptyClassDirectoryQuery: ClassDirectoryQuery = {
  q: '',
  grade: '',
  subject: '',
  instructor: '',
  status: 'active',
  cursor: '',
};

const ALLOWED_STATUSES = new Set(['active', 'inactive', 'archived', 'all']);

function clean(value: string | null | undefined, maxLength = 100): string {
  return (value || '').trim().slice(0, maxLength);
}

export function parseClassDirectoryQuery(params: URLSearchParams): ClassDirectoryQuery {
  const status = clean(params.get('status'), 20);
  return {
    q: clean(params.get('q')),
    grade: clean(params.get('grade'), 40),
    subject: clean(params.get('subject'), 80),
    instructor: clean(params.get('instructor'), 80),
    status: ALLOWED_STATUSES.has(status) ? status : 'active',
    cursor: clean(params.get('cursor'), 1600),
  };
}

export function classDirectoryHref(query: Partial<ClassDirectoryQuery>): string {
  const normalized = { ...emptyClassDirectoryQuery, ...query };
  const params = new URLSearchParams();
  if (normalized.q) params.set('q', normalized.q);
  if (normalized.grade) params.set('grade', normalized.grade);
  if (normalized.subject) params.set('subject', normalized.subject);
  if (normalized.instructor) params.set('instructor', normalized.instructor);
  if (normalized.status !== 'active') params.set('status', normalized.status);
  if (normalized.cursor) params.set('cursor', normalized.cursor);
  const suffix = params.toString();
  return suffix ? `/classrooms?${suffix}` : '/classrooms';
}

export function encodeClassDirectoryCursor(cursor: ClassDirectoryCursor): string {
  return `v2:${encodeURIComponent(cursor.name)}:${cursor.id}`;
}

export function decodeClassDirectoryCursor(
  cursor: string | null | undefined,
): ClassDirectoryCursor | null {
  const match = /^v2:(.*):([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(cursor || '');
  if (!match) return null;
  try {
    const name = decodeURIComponent(match[1]).trim();
    return name ? { name, id: match[2] } : null;
  } catch {
    return null;
  }
}

export function primaryClassGrade(row: ClassSummary): string {
  return row.primaryTargetGrade
    || row.targetGrades?.[0]
    || row.grade
    || '학년 미설정';
}

export function classSubjectLabel(row: ClassSummary): string {
  return row.subjectName || '과목 미설정';
}

function gradeRank(value: string): number {
  const normalized = value.replace(/\s+/g, '');
  const schoolMatch = /^(초등?|중등?|고등?)(\d)/.exec(normalized);
  if (schoolMatch) {
    const schoolRank = schoolMatch[1].startsWith('초') ? 0 : schoolMatch[1].startsWith('중') ? 10 : 20;
    return schoolRank + Number(schoolMatch[2]);
  }
  const numericMatch = /^(\d+)/.exec(normalized);
  if (numericMatch) return 30 + Number(numericMatch[1]);
  return value === '학년 미설정' ? Number.MAX_SAFE_INTEGER : 100;
}

export function compareClassDirectoryRows(a: ClassSummary, b: ClassSummary): number {
  const gradeA = primaryClassGrade(a);
  const gradeB = primaryClassGrade(b);
  return gradeRank(gradeA) - gradeRank(gradeB)
    || gradeA.localeCompare(gradeB, 'ko-KR')
    || classSubjectLabel(a).localeCompare(classSubjectLabel(b), 'ko-KR')
    || a.name.localeCompare(b.name, 'ko-KR')
    || a.id.localeCompare(b.id);
}

export function classMatchesDirectoryQuery(row: ClassSummary, query: ClassDirectoryQuery): boolean {
  const normalizedQuery = query.q.toLocaleLowerCase('ko-KR');
  const text = [row.name, row.subjectName, row.courseTitle, row.instructorName, ...(row.instructors || []).map((item) => item.name)]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('ko-KR');
  const grades = row.targetGrades?.length ? row.targetGrades : [row.grade].filter(Boolean);
  const subjectValue = row.subjectId || row.subjectName || '';

  return (!normalizedQuery || text.includes(normalizedQuery))
    && (!query.grade || grades.includes(query.grade))
    && (!query.subject || subjectValue === query.subject || row.subjectName === query.subject)
    && (!query.instructor || row.defaultInstructorId === query.instructor || row.instructorIds?.includes(query.instructor) === true)
    && (query.status === 'all' || row.status === query.status);
}

export function facetOptions(
  values: Array<{ value: string | null | undefined; label?: string | null | undefined }>,
): ClassDirectoryFacetOption[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const item of values) {
    if (!item.value) continue;
    const current = counts.get(item.value);
    counts.set(item.value, {
      label: item.label || item.value,
      count: (current?.count || 0) + 1,
    });
  }
  return [...counts.entries()]
    .map(([value, item]) => ({ value, label: item.label, count: item.count }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko-KR'));
}
