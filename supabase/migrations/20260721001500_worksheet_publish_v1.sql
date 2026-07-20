-- Worksheet publish v1.
--
-- 1) Redefines learning.submit_session_v2 with per-item evidence overrides:
--    attempts on worksheet items with evidence_eligible = false are always
--    recorded as correction / analysis_eligible = false ('worksheet_practice')
--    regardless of first-attempt status, so a mixed worksheet cannot pollute
--    independent evidence. Worksheet assignments may also mix books, so the
--    problem-scope check relies on the item snapshot for source_type
--    'worksheet'. Behavior for every non-worksheet assignment is unchanged.
--
-- 2) Adds learning.publish_worksheet_v1: one transaction that freezes the
--    variant manifest and materializes each variant into the existing
--    per-student assignment contract (assignment + target + recipient +
--    ordered items). Grade App keeps consuming assignments exactly as before;
--    printed seq equals assignment_items.sort_order equals app order.

create or replace function learning.submit_session_v2(
  p_actor_auth_user_id uuid,
  p_assignment_id uuid,
  p_client_submission_id uuid,
  p_session jsonb,
  p_attempts jsonb
)
returns table (
  session_id uuid,
  replayed boolean,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_person_id uuid;
  v_academy_id uuid;
  v_student_id uuid;
  v_book_id uuid;
  v_assignment_unit_id uuid;
  v_assignment_problem_id text;
  v_assignment_context text;
  v_assignment_active boolean;
  v_assignment_status text;
  v_assignment_available_from timestamptz;
  v_assignment_due_at timestamptz;
  v_session_id uuid;
  v_existing_session_id uuid;
  v_existing_assignment_id uuid;
  v_started_at timestamptz;
  v_scope_label text;
  v_attempt_count integer;
  v_has_item_snapshot boolean;
  v_assignment_source text;
begin
  if p_actor_auth_user_id is null
    or p_assignment_id is null
    or p_client_submission_id is null
  then
    raise exception using
      errcode = '22023',
      message = 'actor, assignment, and client submission id are required';
  end if;

  if jsonb_typeof(coalesce(p_session, 'null'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'session must be a JSON object';
  end if;

  if jsonb_typeof(coalesce(p_attempts, 'null'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'attempts must be a JSON array';
  end if;

  v_attempt_count := jsonb_array_length(p_attempts);
  if v_attempt_count = 0 or v_attempt_count > 1000 then
    raise exception using
      errcode = '22023',
      message = 'attempts must contain between 1 and 1000 rows';
  end if;

  select account.id, account.person_id
  into v_account_id, v_person_id
  from core.user_accounts account
  where account.auth_user_id = p_actor_auth_user_id
    and account.status = 'active'
  limit 1;

  if v_account_id is null or v_person_id is null then
    raise exception using errcode = '42501', message = 'active student account is required';
  end if;

  select
    assignment.academy_id,
    recipient.student_id,
    assignment.book_id,
    assignment.unit_id,
    assignment.problem_id,
    assignment.context,
    assignment.source_type,
    assignment.active,
    assignment.status,
    assignment.available_from,
    assignment.due_at
  into
    v_academy_id,
    v_student_id,
    v_book_id,
    v_assignment_unit_id,
    v_assignment_problem_id,
    v_assignment_context,
    v_assignment_source,
    v_assignment_active,
    v_assignment_status,
    v_assignment_available_from,
    v_assignment_due_at
  from learning.assignments assignment
  join learning.assignment_recipients recipient
    on recipient.assignment_id = assignment.id
   and recipient.active
  join core.students student
    on student.id = recipient.student_id
   and student.academy_id = assignment.academy_id
   and student.person_id = v_person_id
   and student.status = 'active'
  where assignment.id = p_assignment_id
    and exists (
      select 1
      from core.academy_members member
      where member.academy_id = assignment.academy_id
        and member.active
        and member.role = 'student'
        and (
          member.user_account_id = v_account_id
          or member.person_id = v_person_id
        )
    )
  order by recipient.added_at desc, recipient.id
  limit 1;

  if v_student_id is null then
    raise exception using
      errcode = '42501',
      message = 'assignment is not available to this student';
  end if;

  -- Serialize retries before checking the idempotency key. An exact replay must
  -- remain recoverable if the original request committed just before due_at.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_student_id::text || ':' || p_assignment_id::text, 0)
  );

  select session.id, session.assignment_id
  into v_existing_session_id, v_existing_assignment_id
  from learning.sessions session
  where session.core_student_id = v_student_id
    and session.client_submission_id = p_client_submission_id
  order by session.submitted_at desc nulls last, session.id
  limit 1;

  if v_existing_session_id is not null then
    if v_existing_assignment_id is distinct from p_assignment_id then
      raise exception using
        errcode = '23505',
        message = 'client submission id is already used for another assignment';
    end if;

    return query
    select
      v_existing_session_id,
      true,
      (
        select count(*)::integer
        from learning.attempts existing_attempt
        where existing_attempt.session_id = v_existing_session_id
      );
    return;
  end if;

  if not v_assignment_active
    or v_assignment_status <> 'published'
    or (v_assignment_available_from is not null and v_assignment_available_from > now())
    or (v_assignment_due_at is not null and now() > v_assignment_due_at)
  then
    raise exception using
      errcode = '42501',
      message = 'assignment is not available to this student';
  end if;

  if nullif(p_session ->> 'book_id', '') is null
    or (p_session ->> 'book_id')::uuid <> v_book_id
  then
    raise exception using errcode = '22023', message = 'session book does not match assignment';
  end if;

  if nullif(p_session ->> 'context', '') is not null
    and p_session ->> 'context' <> v_assignment_context
  then
    raise exception using errcode = '22023', message = 'session context does not match assignment';
  end if;

  v_scope_label := left(coalesce(nullif(btrim(p_session ->> 'scope_label'), ''), '과제'), 200);
  begin
    v_started_at := coalesce(nullif(p_session ->> 'started_at', '')::timestamptz, now());
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = '22007', message = 'started_at is invalid';
  end;

  if v_started_at > now() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'started_at cannot be in the future';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_attempts) as input(
      problem_id text,
      sub_label text,
      answer_given text,
      correct boolean,
      unsure boolean,
      duration_ms integer,
      response_state text,
      evidence_kind text,
      analysis_eligible boolean,
      exclusion_reason text
    )
    where nullif(btrim(input.problem_id), '') is null
      or input.correct is null
      or input.unsure is null
      or input.response_state not in ('answered', 'unknown', 'blank')
      or (input.duration_ms is not null and input.duration_ms < 0)
      or (
        input.response_state = 'answered'
        and nullif(btrim(coalesce(input.answer_given, '')), '') is null
      )
      or (
        input.response_state = 'unknown'
        and (input.correct or not input.unsure)
      )
      or (
        input.response_state = 'blank'
        and (
          input.correct
          or nullif(btrim(coalesce(input.answer_given, '')), '') is not null
        )
      )
  ) then
    raise exception using errcode = '22023', message = 'attempt payload is invalid';
  end if;

  if (
    select count(*)
    from jsonb_to_recordset(p_attempts) as input(problem_id text, sub_label text)
  ) <> (
    select count(distinct (input.problem_id, coalesce(nullif(btrim(input.sub_label), ''), '')))
    from jsonb_to_recordset(p_attempts) as input(problem_id text, sub_label text)
  ) then
    raise exception using
      errcode = '22023',
      message = 'attempt payload contains duplicate problem parts';
  end if;

  select exists (
    select 1
    from learning.assignment_items item
    where item.assignment_id = p_assignment_id
  ) into v_has_item_snapshot;

  if exists (
    select 1
    from (
      select distinct input.problem_id
      from jsonb_to_recordset(p_attempts) as input(problem_id text)
    ) submitted
    where not exists (
      select 1
      from content.problems problem
      where problem.id = submitted.problem_id
        and (v_assignment_source = 'worksheet' or problem.book_id = v_book_id)
        and (
          (
            v_has_item_snapshot
            and exists (
              select 1
              from learning.assignment_items item
              where item.assignment_id = p_assignment_id
                and item.problem_id = problem.id
            )
          )
          or (
            not v_has_item_snapshot
            and (v_assignment_unit_id is null or problem.unit_id = v_assignment_unit_id)
            and (v_assignment_problem_id is null or problem.id = v_assignment_problem_id)
          )
        )
    )
  ) then
    raise exception using errcode = '42501', message = 'attempt contains an unassigned problem';
  end if;

  if exists (
    select 1
    from content.problems problem
    where (v_assignment_source = 'worksheet' or problem.book_id = v_book_id)
      and (
        (
          v_has_item_snapshot
          and exists (
            select 1
            from learning.assignment_items item
            where item.assignment_id = p_assignment_id
              and item.problem_id = problem.id
          )
        )
        or (
          not v_has_item_snapshot
          and (v_assignment_unit_id is null or problem.unit_id = v_assignment_unit_id)
          and (v_assignment_problem_id is null or problem.id = v_assignment_problem_id)
        )
      )
      and not exists (
        select 1
        from jsonb_to_recordset(p_attempts) as input(problem_id text)
        where input.problem_id = problem.id
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'attempt payload is missing assigned problems';
  end if;

  select session.id
  into v_existing_session_id
  from learning.sessions session
  where session.core_student_id = v_student_id
    and session.assignment_id = p_assignment_id
  order by session.submitted_at desc nulls last, session.id
  limit 1;

  if v_existing_session_id is not null then
    raise exception using
      errcode = '23505',
      message = 'assignment already submitted';
  end if;

  -- Lock all student/problem/sub-part counters in a stable order.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_student_id::text || ':' || input.problem_id || ':' || coalesce(nullif(btrim(input.sub_label), ''), ''),
      0
    )
  )
  from jsonb_to_recordset(p_attempts) as input(problem_id text, sub_label text)
  order by input.problem_id, coalesce(nullif(btrim(input.sub_label), ''), '');

  insert into learning.sessions (
    academy_id,
    student_id,
    core_student_id,
    book_id,
    scope,
    scope_label,
    context,
    assignment_id,
    started_at,
    submitted_at,
    client_submission_id,
    metadata
  )
  select
    v_academy_id,
    p_actor_auth_user_id,
    v_student_id,
    v_book_id,
    jsonb_build_object(
      'problem_ids',
      coalesce(jsonb_agg(problem_id order by problem_id), '[]'::jsonb)
    ),
    v_scope_label,
    v_assignment_context,
    p_assignment_id,
    v_started_at,
    now(),
    p_client_submission_id,
    jsonb_build_object(
      'submission_contract', 'submit_session_v2',
      'evidence_policy_version', 1
    )
  from (
    select distinct input.problem_id
    from jsonb_to_recordset(p_attempts) as input(problem_id text)
  ) submitted
  returning id into v_session_id;

  insert into learning.attempts (
    academy_id,
    session_id,
    student_id,
    core_student_id,
    assignment_id,
    problem_id,
    sub_label,
    answer_given,
    correct,
    unsure,
    attempt_no,
    duration_ms,
    response_state,
    evidence_kind,
    analysis_eligible,
    exclusion_reason,
    evidence_policy_version,
    submitted_at,
    metadata
  )
  select
    v_academy_id,
    v_session_id,
    p_actor_auth_user_id,
    v_student_id,
    p_assignment_id,
    input.problem_id,
    nullif(btrim(input.sub_label), ''),
    input.answer_given,
    input.correct,
    input.unsure,
    coalesce((
      select max(existing.attempt_no)
      from learning.attempts existing
      where existing.core_student_id = v_student_id
        and existing.problem_id = input.problem_id
        and coalesce(existing.sub_label, '') = coalesce(nullif(btrim(input.sub_label), ''), '')
    ), 0) + 1,
    input.duration_ms,
    input.response_state,
    case
      when worksheet_item.evidence_eligible = false then 'correction'
      when v_assignment_context = 'retry' then 'correction'
      when v_assignment_context = 'drill' then 'review'
      when prior.last_submitted_at is null then 'independent_new'
      when now() - prior.last_submitted_at >= interval '7 days' then 'independent_same_delayed'
      else 'correction'
    end,
    case
      when input.response_state = 'blank' then false
      when worksheet_item.evidence_eligible = false then false
      when v_assignment_context = 'retry' then false
      when v_assignment_context = 'drill' then false
      when prior.last_submitted_at is null then true
      when now() - prior.last_submitted_at >= interval '7 days' then true
      else false
    end,
    case
      when input.response_state = 'blank' then 'blank'
      when worksheet_item.evidence_eligible = false then 'worksheet_practice'
      when v_assignment_context = 'retry' then 'correction'
      when v_assignment_context = 'drill' then 'review'
      when prior.last_submitted_at is not null
        and now() - prior.last_submitted_at < interval '7 days'
      then 'same_problem_too_soon'
      else null
    end,
    1,
    now(),
    jsonb_build_object('server_graded', true)
  from jsonb_to_recordset(p_attempts) as input(
    problem_id text,
    sub_label text,
    answer_given text,
    correct boolean,
    unsure boolean,
    duration_ms integer,
    response_state text,
    evidence_kind text,
    analysis_eligible boolean,
    exclusion_reason text
  )
  left join lateral (
    select max(coalesce(existing.submitted_at, existing.created_at)) as last_submitted_at
    from learning.attempts existing
    where existing.core_student_id = v_student_id
      and existing.problem_id = input.problem_id
      and coalesce(existing.sub_label, '') = coalesce(nullif(btrim(input.sub_label), ''), '')
      and existing.response_state <> 'blank'
  ) prior on true
  left join lateral (
    select ws.evidence_eligible
    from learning.assignment_items item
    join learning.worksheet_items ws on ws.assignment_item_id = item.id
    where item.assignment_id = p_assignment_id
      and item.problem_id = input.problem_id
    limit 1
  ) worksheet_item on true
  order by input.problem_id, coalesce(nullif(btrim(input.sub_label), ''), '');

  return query select v_session_id, false, v_attempt_count;
end;
$$;

revoke all on function learning.submit_session_v2(uuid, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function learning.submit_session_v2(uuid, uuid, uuid, jsonb, jsonb)
  to service_role;

create or replace function learning.publish_worksheet_v1(
  p_draft_id uuid,
  p_actor_person_id uuid,
  p_title text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft record;
  v_variant record;
  v_item record;
  v_assignment_id uuid;
  v_assignment_item_id uuid;
  v_book_id uuid;
  v_manifest jsonb;
  v_items jsonb;
  v_artifact record;
  v_published jsonb := '[]'::jsonb;
  v_variant_count integer := 0;
begin
  if p_draft_id is null then
    raise exception using errcode = '22023', message = 'draft id is required';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception using errcode = '22023', message = 'title is required';
  end if;

  select draft.id, draft.academy_id, draft.status, draft.render_revision, draft.layout_version
  into v_draft
  from learning.worksheet_drafts draft
  where draft.id = p_draft_id
  for update;

  if v_draft.id is null then
    raise exception using errcode = '42501', message = 'worksheet draft not found';
  end if;
  if v_draft.status <> 'ready' then
    raise exception using
      errcode = '22023',
      message = 'worksheet draft must be rendered and reviewed before publishing';
  end if;

  for v_variant in
    select variant.id, variant.academy_id, variant.student_id, variant.version_code, variant.status
    from learning.worksheet_variants variant
    where variant.draft_id = p_draft_id
    order by variant.created_at, variant.id
    for update
  loop
    v_variant_count := v_variant_count + 1;

    if v_variant.status <> 'ready' then
      raise exception using
        errcode = '22023',
        message = 'every worksheet variant must be ready before publishing';
    end if;

    -- 명단 검증: 학생이 여전히 이 학원의 활성 학생이어야 한다.
    if not exists (
      select 1
      from core.students student
      where student.id = v_variant.student_id
        and student.academy_id = v_draft.academy_id
        and student.status = 'active'
    ) then
      raise exception using
        errcode = '22023',
        message = 'worksheet student roster changed; review the draft again';
    end if;

    select artifact.id, artifact.sha256, artifact.storage_bucket, artifact.storage_path
    into v_artifact
    from learning.worksheet_artifacts artifact
    where artifact.draft_id = p_draft_id
      and artifact.variant_id = v_variant.id
      and artifact.kind = 'student_pdf'
      and artifact.render_revision = v_draft.render_revision
    limit 1;
    if v_artifact.id is null then
      raise exception using
        errcode = '22023',
        message = 'student PDF artifact is missing for a variant';
    end if;

    select problem.book_id
    into v_book_id
    from learning.worksheet_items item
    join content.problems problem on problem.id = item.problem_id
    where item.variant_id = v_variant.id
    order by item.seq
    limit 1;
    if v_book_id is null then
      raise exception using
        errcode = '22023',
        message = 'worksheet items are missing';
    end if;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'seq', item.seq,
        'problem_id', item.problem_id,
        'role', item.role,
        'evidence_eligible', item.evidence_eligible,
        'challenge_band', item.challenge_band_snapshot,
        'image_sha256', item.image_sha256,
        'similarity_group_id', item.similarity_group_id,
        'answer_snapshot', item.answer_snapshot
      ) order by item.seq
    ), '[]'::jsonb)
    into v_items
    from learning.worksheet_items item
    where item.variant_id = v_variant.id;

    v_manifest := jsonb_build_object(
      'layout_version', v_draft.layout_version,
      'render_revision', v_draft.render_revision,
      'version_code', v_variant.version_code,
      'student_pdf_sha256', v_artifact.sha256,
      'student_pdf_bucket', v_artifact.storage_bucket,
      'student_pdf_path', v_artifact.storage_path,
      'items', v_items
    );

    insert into learning.assignments (
      academy_id, book_id, title, description, context,
      created_by, active, source_type, status, published_at, metadata
    ) values (
      v_draft.academy_id,
      v_book_id,
      p_title || ' (' || v_variant.version_code || ')',
      null,
      'homework',
      p_actor_person_id,
      true,
      'worksheet',
      'published',
      now(),
      jsonb_build_object(
        'worksheet_draft_id', p_draft_id,
        'worksheet_variant_id', v_variant.id,
        'worksheet_version_code', v_variant.version_code
      )
    )
    returning id into v_assignment_id;

    insert into learning.assignment_targets (assignment_id, target_type, student_id, active)
    values (v_assignment_id, 'student', v_variant.student_id, true);

    insert into learning.assignment_recipients (
      assignment_id, academy_id, student_id, source_type, active, added_by
    ) values (
      v_assignment_id, v_draft.academy_id, v_variant.student_id, 'student_direct', true, p_actor_person_id
    );

    for v_item in
      select item.id, item.seq, item.problem_id, problem.book_id as problem_book_id, problem.unit_id
      from learning.worksheet_items item
      join content.problems problem on problem.id = item.problem_id
      where item.variant_id = v_variant.id
      order by item.seq
    loop
      insert into learning.assignment_items (
        assignment_id, book_id, unit_id, problem_id, sort_order
      ) values (
        v_assignment_id, v_item.problem_book_id, v_item.unit_id, v_item.problem_id, v_item.seq
      )
      returning id into v_assignment_item_id;

      update learning.worksheet_items
      set assignment_item_id = v_assignment_item_id
      where id = v_item.id;
    end loop;

    update learning.worksheet_variants
    set status = 'published',
        assignment_id = v_assignment_id,
        manifest = v_manifest
    where id = v_variant.id;

    v_published := v_published || jsonb_build_array(jsonb_build_object(
      'variant_id', v_variant.id,
      'assignment_id', v_assignment_id,
      'version_code', v_variant.version_code
    ));
  end loop;

  if v_variant_count = 0 then
    raise exception using errcode = '22023', message = 'worksheet draft has no variants';
  end if;

  update learning.worksheet_drafts
  set status = 'published',
      published_at = now()
  where id = p_draft_id;

  return jsonb_build_object('draft_id', p_draft_id, 'published', v_published);
end;
$$;

revoke all on function learning.publish_worksheet_v1(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function learning.publish_worksheet_v1(uuid, uuid, text)
  to service_role;
