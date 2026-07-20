begin;

do $$
declare
  v_academy uuid := '30000000-0000-4000-8000-000000000001';
  v_owner_person uuid := '30000000-0000-4000-8000-000000000002';
  v_student_person uuid := '30000000-0000-4000-8000-000000000003';
  v_student_auth uuid := '30000000-0000-4000-8000-000000000004';
  v_student_account uuid := '30000000-0000-4000-8000-000000000005';
  v_student uuid := '30000000-0000-4000-8000-000000000006';
  v_book uuid := '30000000-0000-4000-8000-000000000007';
  v_unit uuid := '30000000-0000-4000-8000-000000000008';
  v_draft uuid := '30000000-0000-4000-8000-000000000009';
  v_variant uuid := '30000000-0000-4000-8000-00000000000a';
  v_client uuid := '30000000-0000-4000-8000-00000000000b';
  v_sha text := repeat('b', 64);
  v_result jsonb;
  v_assignment uuid;
  v_count integer;
  v_kind text;
  v_eligible boolean;
  v_reason text;
begin
  insert into core.academies (id, name) values (v_academy, 'Publish smoke academy');
  insert into core.people (id, primary_academy_id, full_name) values
    (v_owner_person, v_academy, 'Owner'),
    (v_student_person, v_academy, 'Student');
  insert into auth.users (id, email, created_at, updated_at)
  values (v_student_auth, 'publish-smoke@example.test', now(), now());
  insert into core.user_accounts (id, auth_user_id, person_id, auth_email)
  values (v_student_account, v_student_auth, v_student_person, 'publish-smoke@example.test');
  insert into core.academy_members (academy_id, person_id, user_account_id, role)
  values (v_academy, v_student_person, v_student_account, 'student');
  insert into core.students (id, academy_id, person_id) values (v_student, v_academy, v_student_person);

  insert into content.books (id, academy_id, book_key, title, subject, grade)
  values (v_book, v_academy, 'publish-smoke-book', 'Publish smoke book', 'math', '중2');
  insert into content.units (id, book_id, unit_key, name)
  values (v_unit, v_book, 'unit-1', 'Smoke unit');
  insert into content.problems (
    id, book_id, unit_id, page_printed, number, answer, answer_key, public_payload
  ) values
    ('publish-smoke-p1', v_book, v_unit, 1, '1', '{"value":"1"}', '{"value":"1"}', '{}'),
    ('publish-smoke-p2', v_book, v_unit, 1, '2', '{"value":"2"}', '{"value":"2"}', '{}');

  insert into learning.worksheet_drafts (id, academy_id, created_by, status, selection_seed)
  values (v_draft, v_academy, v_owner_person, 'ready', 'publish-smoke-seed');
  insert into learning.worksheet_variants (id, draft_id, academy_id, student_id, version_code, status)
  values (v_variant, v_draft, v_academy, v_student, 'WS-PUB-1', 'ready');
  insert into learning.worksheet_items (
    variant_id, academy_id, seq, problem_id, role, evidence_eligible,
    similarity_group_id, challenge_band_snapshot, answer_snapshot
  ) values
    (v_variant, v_academy, 1, 'publish-smoke-p1', 'verification', true, 'publish-smoke-p1', 2, '{"value":"1"}'),
    (v_variant, v_academy, 2, 'publish-smoke-p2', 'practice', false, 'publish-smoke-p2', 1, '{"value":"2"}');
  insert into learning.worksheet_artifacts (
    academy_id, draft_id, variant_id, kind, render_revision, storage_path, sha256, byte_size, page_count
  ) values (
    v_academy, v_draft, v_variant, 'student_pdf', 1, 'smoke/publish.pdf', v_sha, 1024, 1
  );

  -- 배포: 원자적 물질화
  v_result := learning.publish_worksheet_v1(v_draft, v_owner_person, '스모크 학습지');
  v_assignment := (v_result -> 'published' -> 0 ->> 'assignment_id')::uuid;
  if v_assignment is null then
    raise exception 'publish did not return an assignment id';
  end if;

  -- 지면 번호(seq) = assignment_items.sort_order 완전 일치
  select count(*) into v_count
  from learning.worksheet_items ws
  join learning.assignment_items item on item.id = ws.assignment_item_id
  where ws.variant_id = v_variant
    and item.assignment_id = v_assignment
    and item.sort_order = ws.seq
    and item.problem_id = ws.problem_id;
  if v_count <> 2 then
    raise exception 'printed seq does not match assignment item order (% rows)', v_count;
  end if;

  if not exists (
    select 1 from learning.assignment_recipients recipient
    where recipient.assignment_id = v_assignment
      and recipient.student_id = v_student
      and recipient.active
  ) then
    raise exception 'publish did not create an active recipient';
  end if;

  if not exists (
    select 1 from learning.worksheet_variants variant
    where variant.id = v_variant
      and variant.status = 'published'
      and variant.assignment_id = v_assignment
      and variant.manifest -> 'items' -> 0 ->> 'problem_id' = 'publish-smoke-p1'
  ) then
    raise exception 'variant manifest was not frozen at publish';
  end if;

  -- 이미 배포된 초안은 다시 배포할 수 없다.
  begin
    perform learning.publish_worksheet_v1(v_draft, v_owner_person, '다시');
    raise exception 'republishing a published draft unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  -- 학생 제출 → 문항 단위 증거 분류
  perform learning.submit_session_v2(
    v_student_auth,
    v_assignment,
    v_client,
    jsonb_build_object('book_id', v_book, 'scope_label', '스모크 학습지'),
    jsonb_build_array(
      jsonb_build_object(
        'problem_id', 'publish-smoke-p1', 'answer_given', '1',
        'correct', true, 'unsure', false, 'response_state', 'answered'
      ),
      jsonb_build_object(
        'problem_id', 'publish-smoke-p2', 'answer_given', '2',
        'correct', true, 'unsure', false, 'response_state', 'answered'
      )
    )
  );

  -- 확인 문항: 첫 독립 풀이로 기록되어야 한다.
  select attempt.evidence_kind, attempt.analysis_eligible
  into v_kind, v_eligible
  from learning.attempts attempt
  where attempt.assignment_id = v_assignment and attempt.problem_id = 'publish-smoke-p1';
  if v_kind <> 'independent_new' or not v_eligible then
    raise exception 'verification item was not recorded as independent evidence (%, %)', v_kind, v_eligible;
  end if;

  -- 연습 문항: 첫 풀이라도 절대 독립 증거가 되면 안 된다.
  select attempt.evidence_kind, attempt.analysis_eligible, attempt.exclusion_reason
  into v_kind, v_eligible, v_reason
  from learning.attempts attempt
  where attempt.assignment_id = v_assignment and attempt.problem_id = 'publish-smoke-p2';
  if v_kind <> 'correction' or v_eligible or v_reason <> 'worksheet_practice' then
    raise exception 'practice item polluted evidence (%, %, %)', v_kind, v_eligible, v_reason;
  end if;
end;
$$;

select 'worksheet_publish_v1_smoke_ok' as result;

rollback;
