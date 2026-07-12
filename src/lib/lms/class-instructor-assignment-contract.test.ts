import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const mutations = source('src/lib/lms/mutations.ts');
const queries = source('src/lib/lms/class-queries.ts');
const types = source('src/features/lms/types.ts');
const classForm = source('src/features/lms/classrooms-operations-page.tsx');

function functionSource(name: string, nextMarker: string): string {
  return mutations.slice(mutations.indexOf(`async function ${name}`), mutations.indexOf(nextMarker));
}

describe('class instructor assignment and course contract', () => {
  it('keeps explicit class instructors while preserving the first instructor as the compatibility default', () => {
    expect(types).toContain('instructorIds?: string[];');
    expect(mutations).toContain('const instructorIds = normalizeClassInstructorIds(input.instructorIds, input.defaultInstructorId);');
    expect(mutations).toContain('const defaultInstructorId = instructorIds[0] || null;');
    expect(classForm).toContain('instructorIds: classInstructorIds');
    expect(classForm).toContain('defaultInstructorId: classInstructorIds[0] || null');
  });

  it('validates every selected instructor inside the academy and archives removed assignments', () => {
    const staffValidation = functionSource('assertStaffMembersBelongToAcademy', 'async function assertClassroomBelongsToAcademy');
    const assignmentSync = functionSource('syncClassInstructorAssignments', 'function isBillableStudentStatus');

    expect(staffValidation).toContain(".eq('academy_id', academyId)");
    expect(staffValidation).toContain(".in('id', ids)");
    expect(staffValidation).toContain('(data || []).length !== ids.length');
    expect(assignmentSync).toContain(".update({ active: false, ended_on: toSeoulDate(new Date()) })");
    expect(assignmentSync).toContain('ended_on: null');
    expect(assignmentSync).toContain("{ onConflict: 'class_id,instructor_staff_id' }");
  });

  it('loads optional courses by subject and rejects cross-academy or cross-subject selections', () => {
    const courseValidation = functionSource('assertCourseBelongsToSubject', 'async function syncClassTargetGrades');

    expect(types).toContain('courseId?: string | null;');
    expect(courseValidation).toContain(".eq('academy_id', academyId)");
    expect(courseValidation).toContain(".eq('id', courseId)");
    expect(courseValidation).toContain('data.subject_id !== subjectId');
    expect(mutations).toContain('course_id: input.courseId || null');
    expect(queries).toContain(".select('id,title,subject_id,status')");
    expect(queries).toContain('courseId: profile?.course_id ?? null');
    expect(classForm).toContain('course.subjectId === subjectId');
  });
});
