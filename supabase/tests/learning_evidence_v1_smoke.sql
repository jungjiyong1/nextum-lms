begin;

do $$
declare
  v_academy uuid := '10000000-0000-4000-8000-000000000001';
  v_class uuid := '10000000-0000-4000-8000-000000000002';
  v_owner_auth uuid := '10000000-0000-4000-8000-000000000003';
  v_owner_person uuid := '10000000-0000-4000-8000-000000000004';
  v_owner_account uuid := '10000000-0000-4000-8000-000000000005';
  v_student_auth uuid := '10000000-0000-4000-8000-000000000006';
  v_student_person uuid := '10000000-0000-4000-8000-000000000007';
  v_student_account uuid := '10000000-0000-4000-8000-000000000008';
  v_student uuid := '10000000-0000-4000-8000-000000000009';
  v_book uuid := '10000000-0000-4000-8000-000000000010';
  v_unit uuid := '10000000-0000-4000-8000-000000000011';
  v_revision_one uuid := '10000000-0000-4000-8000-000000000012';
  v_revision_two uuid := '10000000-0000-4000-8000-000000000013';
  v_skill_one uuid := '10000000-0000-4000-8000-000000000014';
  v_skill_two uuid := '10000000-0000-4000-8000-000000000015';
  v_assignment_one uuid := '10000000-0000-4000-8000-000000000016';
  v_assignment_two uuid := '10000000-0000-4000-8000-000000000017';
  v_assignment_three uuid := '10000000-0000-4000-8000-000000000018';
  v_assignment_four uuid := '10000000-0000-4000-8000-000000000019';
  v_assignment_five uuid := '10000000-0000-4000-8000-000000000023';
  v_client_one uuid := '10000000-0000-4000-8000-000000000020';
  v_client_two uuid := '10000000-0000-4000-8000-000000000021';
  v_client_three uuid := '10000000-0000-4000-8000-000000000022';
  v_client_four uuid := '10000000-0000-4000-8000-000000000024';
  v_plan uuid;
  v_session_one uuid;
  v_session_two uuid;
  v_session_three uuid;
  v_replayed boolean;
  v_count integer;
begin
  insert into core.academies (id, name) values (v_academy, 'Evidence smoke academy');
  insert into core.people (id, primary_academy_id, full_name) values
    (v_owner_person, v_academy, 'Owner'),
    (v_student_person, v_academy, 'Student');
  insert into auth.users (id, email, created_at, updated_at) values
    (v_owner_auth, 'owner-smoke@example.test', now(), now()),
    (v_student_auth, 'student-smoke@example.test', now(), now());
  insert into core.user_accounts (id, auth_user_id, person_id, auth_email) values
    (v_owner_account, v_owner_auth, v_owner_person, 'owner-smoke@example.test'),
    (v_student_account, v_student_auth, v_student_person, 'student-smoke@example.test');
  insert into core.academy_members (academy_id, person_id, user_account_id, role) values
    (v_academy, v_owner_person, v_owner_account, 'owner'),
    (v_academy, v_student_person, v_student_account, 'student');
  insert into core.classes (id, academy_id, name) values (v_class, v_academy, 'Smoke class');
  insert into core.students (id, academy_id, person_id) values (v_student, v_academy, v_student_person);
  insert into core.class_students (class_id, student_id) values (v_class, v_student);

  insert into content.books (id, academy_id, book_key, title, subject, grade)
  values (v_book, v_academy, 'evidence-smoke-book', 'Evidence smoke book', 'math', '중2');
  insert into content.units (id, book_id, unit_key, name)
  values (v_unit, v_book, 'unit-1', 'Smoke unit');
  insert into content.problems (
    id, book_id, unit_id, page_printed, number, answer, answer_key, public_payload
  ) values
    ('evidence-smoke-p1', v_book, v_unit, 1, '1', '{"value":"1"}', '{"value":"1"}', '{}'),
    ('evidence-smoke-p2', v_book, v_unit, 1, '2', '{"value":"2"}', '{"value":"2"}', '{}'),
    ('evidence-smoke-p3', v_book, v_unit, 1, '3', '{"value":"3"}', '{"value":"3"}', '{}');

  insert into content.analysis_taxonomy_revisions (
    id, revision_number, status, summary
  ) values
    (v_revision_one, 100001, 'draft', 'smoke revision one'),
    (v_revision_two, 100002, 'draft', 'smoke revision two');
  insert into content.analysis_skills (
    id, taxonomy_revision_id, code, subject, unit_name, name
  ) values
    (v_skill_one, v_revision_one, 'smoke.same-code', 'math', 'Smoke unit', 'Smoke skill'),
    (v_skill_two, v_revision_two, 'smoke.same-code', 'math', 'Smoke unit', 'Smoke skill v2');

  begin
    insert into content.problem_analysis_tags (
      problem_id, analysis_skill_id, taxonomy_revision_id,
      challenge_band, equivalence_key, review_status, reviewed_at
    ) values (
      'evidence-smoke-p1', v_skill_one, v_revision_one,
      2, 'smoke-eq-1', 'approved', now()
    );
    raise exception 'approved tag unexpectedly accepted a draft revision';
  exception when check_violation then
    null;
  end;

  update content.analysis_taxonomy_revisions
  set status = 'published', published_at = now()
  where id = v_revision_one;

  insert into content.problem_analysis_tags (
    problem_id, analysis_skill_id, taxonomy_revision_id,
    challenge_band, equivalence_key, review_status, reviewed_at
  ) values
    ('evidence-smoke-p1', v_skill_one, v_revision_one, 2, 'smoke-eq-1', 'approved', now()),
    ('evidence-smoke-p2', v_skill_one, v_revision_one, 2, 'smoke-eq-2', 'approved', now()),
    ('evidence-smoke-p3', v_skill_one, v_revision_one, 2, 'smoke-eq-3', 'approved', now());

  begin
    update content.problem_analysis_tags
    set taxonomy_revision_id = v_revision_two
    where problem_id = 'evidence-smoke-p1'
      and taxonomy_revision_id = v_revision_one;
    raise exception 'tag unexpectedly accepted a revision different from its skill';
  exception when check_violation then
    null;
  end;

  select result.plan_id
  into v_plan
  from learning.create_analysis_plan_v1(
    v_owner_auth,
    v_academy,
    jsonb_build_object(
      'class_id', v_class,
      'plan_type', 'study_track',
      'track_kind', 'maintenance',
      'name', 'Smoke maintenance',
      'target_challenge_band', 2,
      'exam_date', null,
      'maintenance_interval_days', 21,
      'recheck_interval_days', null,
      'scope_skill_ids', jsonb_build_array(v_skill_one),
      'material_book_ids', '[]'::jsonb,
      'student_overrides', jsonb_build_array(jsonb_build_object(
        'student_id', v_student,
        'target_challenge_band', 3
      ))
    )
  ) result;

  if v_plan is null
     or (select count(*) from learning.analysis_plan_scope where plan_id = v_plan) <> 1
     or (select count(*) from learning.analysis_plan_materials where plan_id = v_plan) <> 0
     or not exists (
       select 1 from learning.analysis_plan_student_overrides
       where plan_id = v_plan
         and student_id = v_student
         and target_challenge_band = 3
     ) then
    raise exception 'atomic bookless plan creation failed';
  end if;

  begin
    insert into learning.analysis_plan_scope (plan_id, analysis_skill_id)
    values (v_plan, v_skill_two);
    raise exception 'plan scope unexpectedly accepted a skill from another revision';
  exception when check_violation then
    null;
  end;

  update content.analysis_taxonomy_revisions
  set status = 'published', published_at = now()
  where id = v_revision_two;

  insert into content.problem_analysis_tags (
    problem_id, analysis_skill_id, taxonomy_revision_id,
    challenge_band, equivalence_key, review_status, reviewed_at
  ) values (
    'evidence-smoke-p1', v_skill_two, v_revision_two,
    3, 'smoke-v2-eq-1', 'approved', now()
  );

  if (
    select count(*)
    from content.problem_analysis_tags
    where problem_id = 'evidence-smoke-p1'
  ) <> 2 then
    raise exception 'problem tags were not retained across taxonomy revisions';
  end if;

  insert into learning.assignments (
    id, academy_id, book_id, title, context, due_at, active, status, published_at
  ) values
    (v_assignment_one, v_academy, v_book, 'Smoke homework', 'homework', now() + interval '1 day', true, 'published', now()),
    (v_assignment_two, v_academy, v_book, 'Smoke collision', 'homework', now() + interval '1 day', true, 'published', now()),
    (v_assignment_three, v_academy, v_book, 'Smoke drill', 'drill', now() + interval '1 day', true, 'published', now()),
    (v_assignment_four, v_academy, v_book, 'Smoke blank', 'homework', now() + interval '1 day', true, 'published', now()),
    (v_assignment_five, v_academy, v_book, 'Smoke exact scope', 'homework', now() + interval '1 day', true, 'published', now());
  insert into learning.assignment_recipients (
    assignment_id, academy_id, student_id, class_id, source_type
  ) values
    (v_assignment_one, v_academy, v_student, v_class, 'class_snapshot'),
    (v_assignment_two, v_academy, v_student, v_class, 'class_snapshot'),
    (v_assignment_three, v_academy, v_student, v_class, 'class_snapshot'),
    (v_assignment_four, v_academy, v_student, v_class, 'class_snapshot'),
    (v_assignment_five, v_academy, v_student, v_class, 'class_snapshot');
  insert into learning.assignment_items (
    assignment_id, book_id, unit_id, problem_id, sort_order
  ) values
    (v_assignment_one, v_book, v_unit, 'evidence-smoke-p1', 0),
    (v_assignment_two, v_book, v_unit, 'evidence-smoke-p2', 0),
    (v_assignment_three, v_book, v_unit, 'evidence-smoke-p2', 0),
    (v_assignment_four, v_book, v_unit, 'evidence-smoke-p3', 0),
    (v_assignment_five, v_book, v_unit, 'evidence-smoke-p1', 0),
    (v_assignment_five, v_book, v_unit, 'evidence-smoke-p2', 1);

  begin
    perform 1
    from learning.submit_session_v2(
      v_student_auth,
      v_assignment_five,
      v_client_four,
      jsonb_build_object('book_id', v_book, 'scope_label', 'partial', 'context', 'homework'),
      jsonb_build_array(jsonb_build_object(
        'problem_id', 'evidence-smoke-p1', 'answer_given', '1',
        'correct', true, 'unsure', false, 'response_state', 'answered'
      ))
    );
    raise exception 'partial assignment scope was unexpectedly accepted';
  exception when invalid_parameter_value then
    null;
  end;

  select result.session_id, result.replayed, result.attempt_count
  into v_session_one, v_replayed, v_count
  from learning.submit_session_v2(
    v_student_auth,
    v_assignment_one,
    v_client_one,
    jsonb_build_object(
      'book_id', v_book,
      'scope_label', 'Smoke homework',
      'context', 'homework',
      'started_at', now() - interval '5 minutes'
    ),
    jsonb_build_array(jsonb_build_object(
      'problem_id', 'evidence-smoke-p1',
      'sub_label', null,
      'answer_given', '1',
      'correct', true,
      'unsure', false,
      'duration_ms', 1000,
      'response_state', 'answered'
    ))
  ) result;

  if v_session_one is null or v_replayed or v_count <> 1 then
    raise exception 'first atomic submission returned an invalid result';
  end if;
  if not exists (
    select 1 from learning.attempts
    where session_id = v_session_one
      and evidence_kind = 'independent_new'
      and analysis_eligible
      and exclusion_reason is null
  ) then
    raise exception 'homework attempt was not classified as independent evidence';
  end if;

  update learning.assignments set due_at = now() - interval '1 minute'
  where id = v_assignment_one;
  select result.session_id, result.replayed, result.attempt_count
  into v_session_two, v_replayed, v_count
  from learning.submit_session_v2(
    v_student_auth,
    v_assignment_one,
    v_client_one,
    jsonb_build_object('book_id', v_book, 'scope_label', 'replay', 'context', 'homework'),
    jsonb_build_array(jsonb_build_object(
      'problem_id', 'evidence-smoke-p1', 'answer_given', '1',
      'correct', true, 'unsure', false, 'response_state', 'answered'
    ))
  ) result;
  if v_session_two <> v_session_one or not v_replayed or v_count <> 1 then
    raise exception 'exact replay after due_at did not recover the committed session';
  end if;

  begin
    perform 1
    from learning.submit_session_v2(
      v_student_auth,
      v_assignment_two,
      v_client_one,
      jsonb_build_object('book_id', v_book, 'scope_label', 'collision', 'context', 'homework'),
      jsonb_build_array(jsonb_build_object(
        'problem_id', 'evidence-smoke-p2', 'answer_given', '2',
        'correct', true, 'unsure', false, 'response_state', 'answered'
      ))
    );
    raise exception 'client submission id unexpectedly crossed assignment boundaries';
  exception when unique_violation then
    null;
  end;

  select result.session_id
  into v_session_two
  from learning.submit_session_v2(
    v_student_auth,
    v_assignment_three,
    v_client_two,
    jsonb_build_object('book_id', v_book, 'scope_label', 'drill', 'context', 'drill'),
    jsonb_build_array(jsonb_build_object(
      'problem_id', 'evidence-smoke-p2', 'answer_given', '2',
      'correct', true, 'unsure', false, 'response_state', 'answered'
    ))
  ) result;
  if not exists (
    select 1 from learning.attempts
    where session_id = v_session_two
      and evidence_kind = 'review'
      and not analysis_eligible
      and exclusion_reason = 'review'
  ) then
    raise exception 'drill attempt was not excluded as review evidence';
  end if;

  select result.session_id
  into v_session_three
  from learning.submit_session_v2(
    v_student_auth,
    v_assignment_four,
    v_client_three,
    jsonb_build_object('book_id', v_book, 'scope_label', 'blank', 'context', 'homework'),
    jsonb_build_array(jsonb_build_object(
      'problem_id', 'evidence-smoke-p3', 'answer_given', null,
      'correct', false, 'unsure', false, 'response_state', 'blank'
    ))
  ) result;
  if not exists (
    select 1 from learning.attempts
    where session_id = v_session_three
      and response_state = 'blank'
      and not analysis_eligible
      and exclusion_reason = 'blank'
  ) then
    raise exception 'blank attempt was not excluded from analysis';
  end if;

  if has_table_privilege('authenticated', 'learning.attempts', 'INSERT') then
    raise exception 'authenticated unexpectedly retains direct attempt INSERT privilege';
  end if;
  if has_table_privilege('authenticated', 'learning.analysis_plans', 'INSERT') then
    raise exception 'authenticated unexpectedly retains direct analysis plan INSERT privilege';
  end if;
  if not exists (
    select 1
    from pg_class relation
    where relation.oid = 'reporting.v_learning_evidence_base'::regclass
      and 'security_invoker=true' = any(coalesce(relation.reloptions, array[]::text[]))
  ) then
    raise exception 'reporting evidence view is not security_invoker';
  end if;
end;
$$;

select 'learning_evidence_v1_smoke_ok' as result;

rollback;
