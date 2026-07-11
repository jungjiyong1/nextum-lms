import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
    process.cwd(),
    'supabase/migrations/20260711100401_schedule_delete_and_conversion.sql',
), 'utf8');
const normalizationMigration = readFileSync(resolve(
    process.cwd(),
    'supabase/migrations/20260711104501_normalize_lesson_occurrence_status.sql',
), 'utf8');

describe('schedule delete and conversion migration contract', () => {
    it('keeps both mutations server-only and scoped to the academy lock', () => {
        expect(migration).toContain("current_user <> 'service_role'");
        expect(migration).toContain("hashtextextended(p_academy_id::text, 1127)");
        expect(migration).toMatch(/revoke all on function lms\.convert_single_schedule_to_recurring_v1[\s\S]*?from public, anon, authenticated;/);
        expect(migration).toMatch(/revoke all on function lms\.delete_schedule_v1[\s\S]*?from public, anon, authenticated;/);
        expect(migration).toMatch(/grant execute on function lms\.delete_schedule_v1[\s\S]*?to service_role;/);
    });

    it('converts atomically by creating a rule and linking the original occurrence', () => {
        expect(normalizationMigration).toContain('select lms.mutate_schedule_v1(');
        expect(normalizationMigration).toContain("v_occurrence.status <> 'normal'");
        expect(normalizationMigration).toContain('Only a normal one-time lesson can be converted.');
        expect(normalizationMigration).toContain('The original lesson date must be the first recurring lesson date.');
        expect(normalizationMigration).toMatch(/update lms\.lesson_occurrences[\s\S]*?set rule_id = v_rule_id/);
    });

    it('preserves attendance and uses a tombstone to suppress one recurring date', () => {
        expect(migration).toContain('A lesson with attendance cannot be deleted.');
        expect(migration).toContain("v_delete_marker constant text := '__nextum_schedule_deleted__'");
        expect(migration).toContain("'scheduleDeleted', true");
        expect(migration).toMatch(/delete from lms\.lesson_occurrences occurrence[\s\S]*?not exists \([\s\S]*?lms\.attendance_records/);
    });

    it('indexes recurring occurrence cleanup by academy, rule, and date', () => {
        expect(migration).toContain('create index if not exists lms_occurrences_rule_date_idx');
        expect(migration).toContain('on lms.lesson_occurrences (academy_id, rule_id, occurrence_date)');
        expect(migration).toContain('where rule_id is not null');
    });
});
