import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function section(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return value.slice(startIndex, endIndex);
}

const mutations = source('src/lib/lms/mutations.ts');
const classQueries = source('src/lib/lms/class-queries.ts');
const migration = source('supabase/migrations/20260711171351_integrated_learning_class_instructor_payroll.sql');

describe('multi-instructor schedule to payroll flow contract', () => {
  it('materializes every recurring participant after batch attendance creates an occurrence', () => {
    const batchAttendance = section(
      mutations,
      'export async function recordAttendanceBatchForAcademy',
      'export async function setClassBookForAcademy',
    );
    expect(batchAttendance).toContain('await ensureMaterializedLessonParticipants(lms, academyId, occurrenceId)');

    const materialization = section(
      mutations,
      'async function ensureMaterializedLessonParticipants',
      'export async function updateLessonOccurrenceForAcademy',
    );
    expect(materialization).toContain(".from('class_schedule_rule_instructors')");
    expect(materialization).toContain(".select('instructor_staff_id,sort_order')");
    expect(materialization).toContain(".from('lesson_occurrence_instructors').insert");
    expect(materialization).toContain('participants.map((participant) => ({');
  });

  it('uses all rule instructors as a read fallback only when no explicit occurrence override exists', () => {
    expect(classQueries).toContain('const inheritedRuleParticipantRows = row.rule_id');
    expect(classQueries).toContain('&& !row.override_scope');
    expect(classQueries).toContain('&& !row.substitute_staff_id');
    expect(classQueries).toContain('&& !row.instructor_staff_id');
    expect(classQueries).toContain('ruleParticipants.get(String(row.rule_id)) || []');
  });

  it('replaces the complete occurrence snapshot and zeros cancelled participant pay', () => {
    const participantSync = section(
      mutations,
      'async function syncScheduleParticipants',
      'export async function mutateScheduleForAcademy',
    );
    expect(participantSync).toMatch(/\.from\('lesson_occurrence_instructors'\)[\s\S]*?\.delete\(\)[\s\S]*?\.from\('lesson_occurrence_instructors'\)\.insert/);
    expect(participantSync).toContain("input.status === 'cancelled'");
    expect(participantSync).toContain('replaces_staff_id: participant.replacesInstructorId || null');
    expect(participantSync).not.toContain(".from('class_instructors')");
  });

  it('validates every participant and replaced instructor against the academy', () => {
    const staffIdCollection = section(
      mutations,
      'function scheduleParticipantStaffIds',
      'export async function deleteScheduleForAcademy',
    );
    expect(staffIdCollection).toContain('participant.instructorId');
    expect(staffIdCollection).toContain('participant.replacesInstructorId');
    expect(staffIdCollection).toContain('input.substituteInstructorId');
    expect(mutations).toContain('await assertStaffMembersBelongToAcademy(core, academyId, scheduleParticipantStaffIds(input))');
    expect(mutations).toContain('One or more selected staff members do not belong to this academy.');
  });

  it('records effective-dated rates instead of overwriting historical lesson pay', () => {
    const staffMutations = section(
      mutations,
      'function normalizeInstructorHourlyRate',
      'function isMissingRpc',
    );
    expect(staffMutations).toContain(".from('instructor_pay_rates').upsert");
    expect(staffMutations).toContain(".select('id,person_id,role,hourly_rate')");
    expect(staffMutations).toContain('if (hourlyRate !== previousHourlyRate)');
    expect(staffMutations).toContain('effective_from: effectiveFrom');
  });

  it('recalculates freelance withholding from the academy settings before saving', () => {
    const paymentMutation = section(
      mutations,
      'function calculatePayrollAmounts',
      'type BillingDraftForAcademy',
    );
    expect(paymentMutation).toContain(".in('key', ['tax_payroll_income_tax_rate', 'tax_payroll_local_tax_rate'])");
    expect(paymentMutation).toContain('grossAmount * Math.max(0, taxRates.incomeTaxRate) / 100');
    expect(paymentMutation).toContain('grossAmount * Math.max(0, taxRates.localTaxRate) / 100');
    expect(paymentMutation).toContain('base_amount: baseAmount');
    expect(paymentMutation).toContain('additional_amount: additionalAmount');
    expect(paymentMutation).toContain('deduction_amount: deductionAmount');
  });

  it('keeps the participant and pay-rate tables tenant-scoped, indexed, and explicitly granted', () => {
    for (const table of [
      'lms.class_schedule_rule_instructors',
      'lms.lesson_occurrence_instructors',
      'lms.instructor_pay_rates',
    ]) {
      expect(migration).toContain(`alter table ${table} enable row level security`);
    }
    expect(migration).toContain('class_schedule_rule_instructors_staff_idx');
    expect(migration).toContain('lesson_occurrence_instructors_staff_idx');
    expect(migration).toContain('instructor_pay_rates_lookup_idx');
    expect(migration).toMatch(/grant select, insert, update, delete on[\s\S]*?lms\.lesson_occurrence_instructors,[\s\S]*?lms\.instructor_pay_rates[\s\S]*?to authenticated;/);
  });
});
