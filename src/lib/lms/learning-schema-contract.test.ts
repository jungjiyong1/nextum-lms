import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schemaSql = readFileSync(
    resolve(
        process.cwd(),
        'supabase/migrations/20260710172114_learning_evidence_schema_v1.sql',
    ),
    'utf8',
);
const submissionSql = readFileSync(
    resolve(
        process.cwd(),
        'supabase/migrations/20260710172924_atomic_learning_submission_v2.sql',
    ),
    'utf8',
);
const planSql = readFileSync(
    resolve(
        process.cwd(),
        'supabase/migrations/20260710174907_create_analysis_plan_v1.sql',
    ),
    'utf8',
);

describe('learning evidence database contract', () => {
    it('keeps response semantics and evidence eligibility enforced in Postgres', () => {
        expect(schemaSql).toContain(
            "response_state = 'unknown' and correct = false and unsure = true",
        );
        expect(schemaSql).toContain(
            "response_state = 'blank' and correct = false and unsure = false",
        );
        expect(schemaSql).toContain('learning_attempts_evidence_eligibility_check');
        expect(schemaSql).toContain("evidence_kind not in ('correction', 'review', 'guided', 'legacy_ambiguous')");
    });

    it('uses explicit grants, RLS, and a security-invoker reporting view', () => {
        expect(schemaSql).toContain('alter table learning.analysis_plans enable row level security');
        expect(schemaSql).toContain('with (security_invoker = true)');
        expect(schemaSql).toContain('revoke all on table');
        expect(schemaSql).toContain('grant select on table');
        expect(schemaSql).toContain('revoke insert, update, delete on learning.attempts from authenticated');
    });

    it('keeps taxonomy revisions internally consistent', () => {
        expect(schemaSql).toContain('unique (taxonomy_revision_id, code)');
        expect(schemaSql).toContain('primary key (problem_id, taxonomy_revision_id)');
        expect(schemaSql).toContain('Problem tag taxonomy revision must match its analysis skill.');
        expect(schemaSql).toContain('Active analysis plans require a published taxonomy revision.');
        expect(schemaSql).toContain('Analysis child skill revision does not match its plan.');
        expect(schemaSql).toContain('create trigger enforce_analysis_plan_scope_context');
        expect(schemaSql).toContain('Plans and their children must be written atomically');
        expect(schemaSql).toContain('revoke insert, update, delete on table\n  learning.analysis_plans');
        expect(planSql).toContain("case when v_plan_type = 'exam' then v_exam_date else null end");
    });

    it('submits atomically and derives practice classifications on the server', () => {
        expect(submissionSql).toContain('security definer');
        expect(submissionSql).toContain("set search_path = ''");
        expect(submissionSql).toContain('pg_catalog.pg_advisory_xact_lock');
        expect(submissionSql).toContain("when v_assignment_context = 'retry' then 'correction'");
        expect(submissionSql).toContain("when v_assignment_context = 'drill' then 'review'");
        expect(submissionSql).toContain("when input.response_state = 'blank' then false");
        expect(submissionSql).toContain('assignment already submitted');
        expect(submissionSql).toContain('attempt payload is missing assigned problems');
        expect(submissionSql).toContain("existing.response_state <> 'blank'");
        expect(submissionSql).toContain(
            'client submission id is already used for another assignment',
        );
        expect(submissionSql.indexOf('if v_existing_session_id is not null')).toBeLessThan(
            submissionSql.indexOf('if not v_assignment_active'),
        );
        expect(submissionSql).toContain(
            'revoke all on function learning.submit_session_v2(uuid, uuid, uuid, jsonb, jsonb)',
        );
    });
});
