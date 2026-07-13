import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = resolve(process.cwd(), 'supabase/migrations');
const migrationName = readdirSync(migrationDirectory).find((name) => (
    name.endsWith('_studyq_math_bank_code_match_v1.sql')
));
if (!migrationName) throw new Error('StudyQ math bank migration is missing');
const migration = readFileSync(resolve(migrationDirectory, migrationName), 'utf8');
const importer = readFileSync(resolve(process.cwd(), 'scripts/import-studyq-bank.mjs'), 'utf8');

function functionBody(signature: string): string {
    const start = migration.indexOf(signature);
    expect(start, `Missing ${signature}`).toBeGreaterThanOrEqual(0);
    const end = migration.indexOf('\n$$;', start);
    expect(end, `Unterminated ${signature}`).toBeGreaterThan(start);
    return migration.slice(start, end);
}

function importerFunctionBody(signature: string, nextSignature: string): string {
    const start = importer.indexOf(signature);
    expect(start, `Missing importer ${signature}`).toBeGreaterThanOrEqual(0);
    const end = importer.indexOf(nextSignature, start);
    expect(end, `Unterminated importer ${signature}`).toBeGreaterThan(start);
    return importer.slice(start, end);
}

describe('StudyQ single-bank schema and importer contract', () => {
    it('uses one authoritative source-code map and keeps import internals service-only', () => {
        expect(migration).toContain('primary key (academy_id, source_namespace, external_id)');
        expect(migration).toContain("check (source_namespace <> 'studyq' or external_id ~ '^[0-9]{7}$')");
        expect(migration).toContain('unique (academy_id, bundle_sha256)');
        expect(migration).toContain('content.studyq_import_stage_problems');
        expect(migration).toContain('content.studyq_import_stage_skills');
        expect(migration).toContain('content.studyq_import_attempts');
        expect(migration).toContain('content.studyq_import_attempt_assets');
        expect(migration).toMatch(/revoke all on table[\s\S]*?content\.studyq_import_stage_problems,[\s\S]*?from public, anon, authenticated;/);
        expect(migration).toMatch(/grant all privileges on table[\s\S]*?content\.studyq_import_stage_skills[\s\S]*?to service_role;/);
    });

    it('scopes problem type uniqueness to its unit and preserves sub-question choices', () => {
        expect(migration).toContain('unique (book_id, unit_id, name)');
        const body = functionBody('create or replace function content.problem_public_payload(answer jsonb)');
        expect(body).toContain("when jsonb_typeof(sub->'choices') = 'array' then sub->'choices'");
        expect(body).toContain("else sub->>'type' = 'text'");
        expect(body).not.toContain("jsonb_array_length(answer->'subs') > 0),");
    });

    it('allows assignments only from catalog-visible books and verified problems', () => {
        const body = functionBody('create or replace function learning.create_assignment_v2(');
        expect(body).toContain("b.metadata->>'visibility' = 'catalog'");
        expect(body).toContain('and p.verified;');
        expect(migration).toContain("where not (coalesce(metadata, '{}'::jsonb) ? 'visibility')");
    });

    it('finalizes a locked match job through v2 and exposes the RPC only to service role', () => {
        const body = functionBody('create or replace function learning.create_assignment_from_code_match_v1(');
        expect(body).toContain('for update;');
        expect(body).toContain('content.problem_source_refs');
        expect(body).toContain('from learning.create_assignment_v2(');
        expect(body).toContain('insert into learning.assignment_files');
        expect(body).toContain("'student_visible', true");
        expect(body).toContain("item.status <> 'matched'");
        expect(migration).toMatch(/revoke all on function learning\.create_assignment_from_code_match_v1[\s\S]*?from public, anon, authenticated;/);
        expect(migration).toMatch(/grant execute on function learning\.create_assignment_from_code_match_v1[\s\S]*?to service_role;/);
    });

    it('exposes only explicitly student-visible PDF attachments', () => {
        expect(migration).toContain("assignment_file.media_type = 'application/pdf'");
        expect(migration).toContain("assignment_file.metadata ->> 'student_visible' = 'true'");
        expect(migration).not.toContain('create policy assignment_files_objects_update');
        expect(migration).not.toContain('create policy assignment_files_objects_delete');
        expect(migration).toContain('drop policy if exists learning_assignment_files_update on learning.assignment_files');
        expect(migration).toContain('drop policy if exists learning_assignment_files_delete on learning.assignment_files');
        expect(migration).toContain('revoke update, delete on table learning.assignment_files from authenticated');
    });

    it('serializes staged imports and checks every expected total inside one commit transaction', () => {
        const body = functionBody('create or replace function content.commit_studyq_import_v2(');
        const applyBody = importerFunctionBody('async function applyImport(', '\nfunction printHelp(');
        expect(body).toContain('pg_catalog.pg_advisory_xact_lock');
        expect(body).toContain('v_current_count + v_added_count <> v_run.expected_bank_problem_count');
        expect(body).toContain("when v_run.publish_requested then 'catalog'");
        expect(body).toContain('verified, metadata');
        expect(body).toContain('true,');
        expect(importer).toContain("visibility: 'import_staging'");
        expect(applyBody).toContain("content.from('studyq_import_stage_problems')");
        expect(applyBody).toContain("content.rpc('commit_studyq_import_v2'");
        expect(applyBody).not.toContain("content.from('problems')");
        expect(migration).toMatch(/revoke all on function content\.commit_studyq_import_v2\(uuid, uuid\)[\s\S]*?from public, anon, authenticated;/);
        expect(migration).toMatch(/grant execute on function content\.commit_studyq_import_v2\(uuid, uuid\)[\s\S]*?to service_role;/);
    });

    it('cleans up only attempt-created unreferenced Storage objects with retry audit', () => {
        const claimBody = functionBody('create or replace function content.claim_studyq_import_asset_cleanup_v1(');
        const completeBody = functionBody('create or replace function content.complete_studyq_import_asset_cleanup_v1(');
        const applyBody = importerFunctionBody('async function applyImport(', '\nfunction printHelp(');
        expect(claimBody).toContain('not creator.existed_before');
        expect(claimBody).toContain('content.assets canonical_asset');
        expect(claimBody).toContain("other_run.status in ('running', 'succeeded')");
        expect(claimBody).toContain("active_attempt.status in ('running', 'cleanup_pending')");
        expect(claimBody).toContain("cleanup_status = 'claimed'");
        expect(completeBody).toContain('Storage object still exists after remove returned success.');
        expect(migration).toContain('prevent_claimed_studyq_asset_reference');
        expect(applyBody).toContain('cleanupStudyqAttemptAssets(client, content, attemptId)');
        expect(importer).toContain(".remove(claimedPaths)");
        expect(importer).toContain('completeCleanupWithRetry');
    });

    it('defaults to dry-run and blocks changed content under an existing code', () => {
        expect(importer).toContain('apply: false');
        expect(importer).toContain('content changed under an existing source code');
        expect(importer).toContain("invariant(approval.approved === true");
        expect(importer).toContain("verification.unresolved_count === 0");
        expect(importer).toContain("bundle_version: BUNDLE_VERSION");
        expect(importer).toContain('manifest.bank_problem_count_after_import === 9538');
        expect(importer).toContain("'--apply requires a non-empty --execution-sha");
    });

    it('claims expired cleanup work without blocking concurrent workers', () => {
        const body = functionBody('create or replace function learning.expire_assignment_matches_v1(');
        expect(body).toContain('for update skip locked');
        expect(body).toContain("set status = 'expired'");
        expect(body).toContain('job.file_path');
        expect(migration).toContain('source_deleted_at        timestamptz');
        expect(migration).toContain('learning_assignment_match_jobs_source_cleanup_idx');
        expect(migration).toMatch(/grant execute on function learning\.expire_assignment_matches_v1[\s\S]*?to service_role;/);
    });

    it('does not break existing assignment or student deletion flows', () => {
        expect(migration).toContain('target_student_id        uuid references core.students (id) on delete set null');
        expect(migration).toContain('assignment_id            uuid unique references learning.assignments (id) on delete set null');
        const body = functionBody('create or replace function learning.create_assignment_from_code_match_v1(');
        expect(body).toContain("'finalized_assignment_id', v_assignment_id");
        expect(body).toContain("'original_target_student_id', v_job.target_student_id");
    });

    it('lets instructors read only match work they created', () => {
        expect(migration).toContain('create policy assignment_match_batches_instructor_select');
        expect(migration).toContain('create policy assignment_match_jobs_instructor_select');
        expect(migration).toContain('create policy assignment_match_items_instructor_select');
        expect(migration.match(/created_by = core\.current_person_id\(\)/gu)?.length).toBeGreaterThanOrEqual(3);
        expect(migration.match(/current_academy_ids\(array\['teacher', 'instructor'\]\)/gu)?.length).toBeGreaterThanOrEqual(3);
    });
});
