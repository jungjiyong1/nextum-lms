begin;

do $$
declare
  v_academy uuid := '20000000-0000-4000-8000-000000000001';
  v_class uuid := '20000000-0000-4000-8000-000000000002';
  v_owner_person uuid := '20000000-0000-4000-8000-000000000003';
  v_student_person uuid := '20000000-0000-4000-8000-000000000004';
  v_student uuid := '20000000-0000-4000-8000-000000000005';
  v_book uuid := '20000000-0000-4000-8000-000000000006';
  v_unit uuid := '20000000-0000-4000-8000-000000000007';
  v_draft uuid := '20000000-0000-4000-8000-000000000008';
  v_variant uuid := '20000000-0000-4000-8000-000000000009';
  v_artifact uuid := '20000000-0000-4000-8000-000000000010';
  v_sha text := repeat('a', 64);
  v_count integer;
begin
  insert into core.academies (id, name) values (v_academy, 'Worksheet smoke academy');
  insert into core.people (id, primary_academy_id, full_name) values
    (v_owner_person, v_academy, 'Owner'),
    (v_student_person, v_academy, 'Student');
  insert into core.classes (id, academy_id, name) values (v_class, v_academy, 'Smoke class');
  insert into core.students (id, academy_id, person_id) values (v_student, v_academy, v_student_person);
  insert into core.class_students (class_id, student_id) values (v_class, v_student);

  insert into content.books (id, academy_id, book_key, title, subject, grade)
  values (v_book, v_academy, 'worksheet-smoke-book', 'Worksheet smoke book', 'math', '중2');
  insert into content.units (id, book_id, unit_key, name)
  values (v_unit, v_book, 'unit-1', 'Smoke unit');
  insert into content.problems (
    id, book_id, unit_id, page_printed, number, answer, answer_key, public_payload
  ) values
    ('worksheet-smoke-p1', v_book, v_unit, 1, '1', '{"value":"1"}', '{"value":"1"}', '{}'),
    ('worksheet-smoke-p2', v_book, v_unit, 1, '2', '{"value":"2"}', '{"value":"2"}', '{}');

  -- content.assets render metadata columns accept valid values.
  insert into content.assets (book_id, problem_id, kind, storage_path, width, height, byte_size, sha256)
  values (v_book, 'worksheet-smoke-p1', 'problem_image', 'smoke/p1.png', 800, 600, 12345, v_sha);

  begin
    insert into content.assets (book_id, problem_id, kind, storage_path, sha256)
    values (v_book, 'worksheet-smoke-p2', 'problem_image', 'smoke/p2.png', 'not-a-hash');
    raise exception 'assets accepted an invalid sha256';
  exception when check_violation then
    null;
  end;

  -- Whole-bank grant is unique per academy.
  insert into content.problem_bank_grants (academy_id, granted_by)
  values (v_academy, v_owner_person);

  begin
    insert into content.problem_bank_grants (academy_id, granted_by)
    values (v_academy, v_owner_person);
    raise exception 'duplicate whole-bank grant unexpectedly accepted';
  exception when unique_violation then
    null;
  end;

  -- Draft, variant, and items happy path.
  insert into learning.worksheet_drafts (id, academy_id, class_id, created_by, selection_seed)
  values (v_draft, v_academy, v_class, v_owner_person, 'seed-smoke-1');

  insert into learning.worksheet_variants (id, draft_id, academy_id, student_id, version_code)
  values (v_variant, v_draft, v_academy, v_student, 'WS-SMOKE-1');

  insert into learning.worksheet_items (
    variant_id, academy_id, seq, problem_id, role, evidence_eligible, similarity_group_id
  ) values
    (v_variant, v_academy, 1, 'worksheet-smoke-p1', 'verification', true, 'worksheet-smoke-p1'),
    (v_variant, v_academy, 2, 'worksheet-smoke-p2', 'practice', false, 'worksheet-smoke-p2');

  -- Duplicate seq and duplicate problem within a variant are rejected.
  begin
    insert into learning.worksheet_items (
      variant_id, academy_id, seq, problem_id, role, similarity_group_id
    ) values (v_variant, v_academy, 1, 'worksheet-smoke-p1', 'practice', 'worksheet-smoke-p1');
    raise exception 'duplicate item unexpectedly accepted';
  exception when unique_violation then
    null;
  end;

  -- Practice items must not be evidence eligible.
  begin
    insert into learning.worksheet_items (
      variant_id, academy_id, seq, problem_id, role, evidence_eligible, similarity_group_id
    ) values (v_variant, v_academy, 3, 'worksheet-smoke-p2', 'practice', true, 'worksheet-smoke-p2');
    raise exception 'evidence-eligible practice item unexpectedly accepted';
  exception when check_violation then
    null;
  end;

  -- A variant cannot be published without a frozen manifest and assignment.
  begin
    update learning.worksheet_variants set status = 'published' where id = v_variant;
    raise exception 'publish without manifest unexpectedly accepted';
  exception when check_violation then
    null;
  end;

  -- Render jobs are idempotent per academy key.
  insert into learning.worksheet_render_jobs (
    academy_id, draft_id, variant_id, kind, render_revision, idempotency_key
  ) values (v_academy, v_draft, v_variant, 'student_pdf', 1, 'smoke-job-1');

  begin
    insert into learning.worksheet_render_jobs (
      academy_id, draft_id, variant_id, kind, render_revision, idempotency_key
    ) values (v_academy, v_draft, v_variant, 'student_pdf', 1, 'smoke-job-1');
    raise exception 'duplicate render job unexpectedly accepted';
  exception when unique_violation then
    null;
  end;

  -- Student PDF jobs and artifacts require a variant; draft-level kinds must not have one.
  begin
    insert into learning.worksheet_render_jobs (
      academy_id, draft_id, kind, render_revision, idempotency_key
    ) values (v_academy, v_draft, 'student_pdf', 1, 'smoke-job-2');
    raise exception 'variantless student_pdf job unexpectedly accepted';
  exception when check_violation then
    null;
  end;

  insert into learning.worksheet_artifacts (
    id, academy_id, draft_id, variant_id, kind, render_revision,
    storage_path, sha256, byte_size
  ) values (
    v_artifact, v_academy, v_draft, v_variant, 'student_pdf', 1,
    'smoke/worksheet.pdf', v_sha, 2048
  );

  begin
    insert into learning.worksheet_artifacts (
      academy_id, draft_id, variant_id, kind, render_revision, storage_path, sha256, byte_size
    ) values (
      v_academy, v_draft, v_variant, 'student_pdf', 1, 'smoke/dup.pdf', v_sha, 2048
    );
    raise exception 'duplicate artifact identity unexpectedly accepted';
  exception when unique_violation then
    null;
  end;

  -- A job cannot succeed without an artifact.
  begin
    update learning.worksheet_render_jobs
    set status = 'succeeded'
    where idempotency_key = 'smoke-job-1';
    raise exception 'succeeded job without artifact unexpectedly accepted';
  exception when check_violation then
    null;
  end;

  update learning.worksheet_render_jobs
  set status = 'succeeded', artifact_id = v_artifact, finished_at = now()
  where idempotency_key = 'smoke-job-1';

  insert into learning.worksheet_recommendation_logs (
    academy_id, draft_id, variant_id, student_id, problem_id, event, role, reason_code
  ) values (
    v_academy, v_draft, v_variant, v_student, 'worksheet-smoke-p1',
    'replaced', 'verification', 'image_quality'
  );

  -- Worksheet tables stay service-role only: RLS enabled, zero policies,
  -- and no privileges for the authenticated role.
  select count(*) into v_count
  from pg_class rel
  join pg_namespace ns on ns.oid = rel.relnamespace
  where (ns.nspname, rel.relname) in (
      ('content', 'problem_bank_grants'),
      ('learning', 'worksheet_drafts'),
      ('learning', 'worksheet_variants'),
      ('learning', 'worksheet_items'),
      ('learning', 'worksheet_artifacts'),
      ('learning', 'worksheet_render_jobs'),
      ('learning', 'worksheet_recommendation_logs')
    )
    and rel.relrowsecurity;
  if v_count <> 7 then
    raise exception 'expected RLS enabled on 7 worksheet tables, found %', v_count;
  end if;

  select count(*) into v_count
  from pg_policies
  where (schemaname, tablename) in (
      ('content', 'problem_bank_grants'),
      ('learning', 'worksheet_drafts'),
      ('learning', 'worksheet_variants'),
      ('learning', 'worksheet_items'),
      ('learning', 'worksheet_artifacts'),
      ('learning', 'worksheet_render_jobs'),
      ('learning', 'worksheet_recommendation_logs')
    );
  if v_count <> 0 then
    raise exception 'worksheet tables must not define RLS policies, found %', v_count;
  end if;

  if has_table_privilege('authenticated', 'learning.worksheet_drafts', 'select')
    or has_table_privilege('authenticated', 'learning.worksheet_items', 'select')
    or has_table_privilege('anon', 'learning.worksheet_drafts', 'select')
    or has_table_privilege('authenticated', 'content.problem_bank_grants', 'select') then
    raise exception 'worksheet tables must not be readable by anon/authenticated';
  end if;
end;
$$;

select 'worksheet_v1_smoke_ok' as result;

rollback;
