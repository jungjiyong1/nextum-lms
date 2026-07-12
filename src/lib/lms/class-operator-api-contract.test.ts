import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const durableRoutes = [
  'src/app/api/lms/schedule-rules/route.ts',
  'src/app/api/lms/schedules/delete/route.ts',
  'src/app/api/lms/schedule-conflicts/route.ts',
  'src/app/api/lms/classes/members/route.ts',
  'src/app/api/lms/class-books/route.ts',
];

describe('class operator API authorization contract', () => {
  it('admits teacher roles only behind durable class authorization', () => {
    for (const path of durableRoutes) {
      const contents = source(path);
      expect(contents, path).toContain("['owner', 'admin', 'staff', 'teacher', 'instructor']");
      expect(contents, path).toContain('assertDurableClassOperatorAccess');
    }
  });

  it('keeps class creation and global room/book master data manager-only', () => {
    const classes = source('src/app/api/lms/classes/route.ts');
    expect(classes).toMatch(/if \(body\.classId\)[\s\S]*?assertDurableClassOperatorAccess/);
    expect(classes).toMatch(/else \{[\s\S]*?\['owner', 'admin', 'staff'\][\s\S]*?createClassForAcademy/);

    for (const path of [
      'src/app/api/lms/classrooms/route.ts',
      'src/app/api/lms/books/route.ts',
    ]) {
      const contents = source(path);
      expect(contents, path).toContain("['owner', 'admin', 'staff']");
      expect(contents, path).not.toContain("'teacher', 'instructor'");
    }
  });

  it('does not use schedule rules as unconditional durable class assignments', () => {
    const access = source('src/lib/lms/class-access.ts');
    expect(access).not.toContain("from('class_schedule_rule_instructors')");
    expect(access).not.toContain('anyAssignedRuleMatches');

    const queries = source('src/lib/lms/class-queries.ts');
    const loader = queries.slice(
      queries.indexOf('async function loadAssignedClassIds'),
      queries.indexOf('export async function loadAssignedClassIdsForContext'),
    );
    expect(loader).not.toContain("from('class_schedule_rules')");
  });

  it('scopes attendance and roster reads to the exact participated occurrence', () => {
    expect(source('src/app/api/lms/attendance/route.ts')).toContain('assertOccurrenceStatusAccess');
    const detailRoute = source('src/app/api/lms/classes/detail/route.ts');
    expect(detailRoute).toContain("params.get('occurrenceId')");
    expect(detailRoute).toContain('loadClassOperationsDetail(actor, classId, occurrenceId)');
  });

  it('keeps the legacy occurrence update path limited to status, reason, and notes', () => {
    const mutations = source('src/lib/lms/mutations.ts');
    const functionStart = mutations.indexOf('export async function updateLessonOccurrenceForAcademy');
    const updatesStart = mutations.indexOf('const updates: Row = {', functionStart);
    const updateCall = mutations.indexOf(".from('lesson_occurrences')", updatesStart);
    const updateShape = mutations.slice(updatesStart, updateCall);

    expect(updateShape).toContain('status: lessonStatusRpcValue(status)');
    expect(updateShape).toContain('cancel_reason:');
    expect(updateShape).toContain('updates.notes');
    expect(updateShape).not.toContain('occurrence_date');
    expect(updateShape).not.toContain('rule_id');
    expect(updateShape).not.toContain('start_time');
    expect(updateShape).not.toContain('end_time');
    expect(updateShape).not.toContain('participants');
  });
});
