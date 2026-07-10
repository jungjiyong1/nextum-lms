import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260710062202_class_operations_workflow_v1.sql',
), 'utf8');

describe('class operations workflow migration contract', () => {
  it('keeps schedule, membership, and attendance mutations server-only', () => {
    for (const name of [
      'lms.schedule_conflicts_v1',
      'lms.mutate_schedule_v1',
      'lms.change_class_members_v1',
      'lms.record_attendance_batch_v1',
    ]) {
      expect(migration).toContain(`revoke all on function ${name}`);
    }
    expect(migration).toMatch(/grant execute on function lms\.mutate_schedule_v1[\s\S]*?to service_role;/);
    expect(migration).toMatch(/grant execute on function private\.schedule_rules_overlap_v1[\s\S]*?to service_role;/);
  });

  it('serializes schedule and roster writes with scoped advisory locks', () => {
    expect(migration).toContain("hashtextextended(p_academy_id::text, 1127)");
    expect(migration).toContain("hashtextextended(p_class_id::text, 2201)");
    expect(migration).toContain("hashtextextended(v_student_id::text, 2202)");
    expect(migration).toContain("coalesce(p_rule_id::text, 'none')");
  });

  it('never permits same-class overlap while retaining audited resource overrides', () => {
    expect(migration).toContain("where conflict.value ->> 'kind' = 'class'");
    expect(migration).toContain('A class cannot have overlapping schedules.');
    expect(migration).toContain("'conflictOverrideReason'");
    expect(migration).toContain("'conflictOverrideBy'");
    expect(migration).toContain("'conflictOverrideAt'");
  });

  it('uses the snake-case attendance payload emitted by the server wrapper', () => {
    expect(migration).toContain("count(distinct (record->>'student_id'))");
    expect(migration).toContain("select (record->>'student_id')::uuid");
    expect(migration).toMatch(/jsonb_to_recordset\(p_records\)[\s\S]*?student_id uuid/);
    expect(migration).toContain('Attendance cannot be recorded for a cancelled lesson.');
  });

  it('adds conflict lookup indexes for active rules and concrete occurrences', () => {
    for (const index of [
      'lms_rules_active_instructor_conflict_idx',
      'lms_rules_active_classroom_conflict_idx',
      'lms_occurrences_instructor_conflict_idx',
      'lms_occurrences_substitute_conflict_idx',
      'lms_occurrences_classroom_conflict_idx',
    ]) {
      expect(migration).toContain(`create index if not exists ${index}`);
    }
  });
});
