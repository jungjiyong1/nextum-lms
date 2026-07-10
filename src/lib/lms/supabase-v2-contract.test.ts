import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
    process.cwd(),
    'supabase/migrations/20260709194443_supabase_growth_optimization_v2.sql',
), 'utf8');
const baseline = readFileSync(resolve(
    process.cwd(),
    'supabase/migrations/0001_nextum_lms_baseline.sql',
), 'utf8');
const migrationFiles = new Set(readdirSync(resolve(process.cwd(), 'supabase/migrations')));

function functionBody(signatureStart: string): string {
    const start = migration.indexOf(signatureStart);
    expect(start, `Missing ${signatureStart}`).toBeGreaterThanOrEqual(0);
    const end = migration.indexOf('\n$$;', start);
    expect(end, `Unterminated ${signatureStart}`).toBeGreaterThan(start);
    return migration.slice(start, end);
}

describe('Supabase growth v2 migration contract', () => {
    it('keeps the clean baseline compatible with the remote Grade content schema', () => {
        expect(baseline).toMatch(/problem_type_id\s+uuid[\s\S]*?type_id\s+uuid/);
        for (const marker of [
            '20260705121256_create_lms_schema.sql',
            '20260705140030_core_content_learning_bridge.sql',
            '20260705140157_lms_core_sync_and_compat_views.sql',
            '20260705140608_learning_fk_content_core_student.sql',
            '20260705140806_lms_profile_core_sync.sql',
            '20260705140956_security_advisor_cleanup.sql',
            '20260705141056_performance_indexes_and_policy_cleanup.sql',
            '20260705141251_backfill_learning_core_student_ids.sql',
            '20260705161155_security_and_lms_correctness_hardening.sql',
        ]) {
            expect(migrationFiles.has(marker), marker).toBe(true);
        }
    });

    it('removes local-only permissive policies while preserving canonical access', () => {
        expect(migration).toContain('drop policy if exists user_accounts_self_select');
        expect(migration).toContain('drop policy if exists user_accounts_staff_select');
        expect(migration).toContain('create policy user_accounts_self');
        expect(migration).toContain('drop policy if exists staff_access');
    });

    it('keeps item snapshots narrower than the legacy assignment fallback', () => {
        const body = functionBody('create or replace function private.accessible_problem_ids()');

        expect(body).toContain('from learning.assignment_items item');
        expect(body).toContain('and (aa.unit_id is null or aa.unit_id = p.unit_id)');
        expect(body).toContain('and (aa.problem_id is null or aa.problem_id = p.id)');
        expect(body).toMatch(/where not exists \(\s*select 1\s*from learning\.assignment_items item/s);
    });

    it('excludes direct students consistently and preserves their primary class scope', () => {
        const body = functionBody('create or replace function learning.create_assignment_v2(');
        const exclusions = body.match(/input\.student_id <> all\(v_excluded_student_ids\)/g) ?? [];

        expect(exclusions.length).toBeGreaterThanOrEqual(2);
        expect(body).toContain('enrollment.student_id <> all(v_excluded_student_ids)');
        expect(body).toContain('left join lateral');
        expect(body).toContain('order by enrollment.primary_class desc, enrollment.joined_at desc, enrollment.class_id');
        expect(body).toMatch(/unit_id,\r?\n\s+problem_id,/);
    });

    it('reports every bounded class read collection instead of silently truncating it', () => {
        const body = functionBody('create or replace function lms.class_operations_read_v2(');

        for (const key of [
            'classes',
            'scheduleRules',
            'occurrences',
            'attendance',
            'books',
            'staff',
            'classrooms',
        ]) {
            expect(body).toContain(`'${key}'`);
        }
        expect(body).toContain("'truncated', jsonb_build_object(");
    });

    it('does not grant the new v2 APIs to anonymous callers', () => {
        for (const signature of [
            'learning.list_problem_catalog_v2(uuid, uuid, uuid, boolean, integer, text, integer)',
            'lms.class_operations_read_v2(uuid, text, date, date, uuid[], integer)',
            'learning.create_assignment_v2(uuid, uuid, text, text[], uuid[], uuid[], text, text, timestamptz, timestamptz, jsonb, uuid[], uuid, text)',
        ]) {
            expect(migration).toContain(`revoke all on function ${signature}`);
        }
    });
});
