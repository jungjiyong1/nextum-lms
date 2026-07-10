-- Make Grade App submissions atomic, idempotent, and server-authoritative.
-- This RPC is intentionally executable only by service_role. The authenticated
-- HTTP route grades answers, while the database revalidates actor ownership,
-- assignment scope, response shape, and attempt ordering in one transaction.

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
        and problem.book_id = v_book_id
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
    where problem.book_id = v_book_id
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
      when v_assignment_context = 'retry' then 'correction'
      when v_assignment_context = 'drill' then 'review'
      when prior.last_submitted_at is null then 'independent_new'
      when now() - prior.last_submitted_at >= interval '7 days' then 'independent_same_delayed'
      else 'correction'
    end,
    case
      when input.response_state = 'blank' then false
      when v_assignment_context = 'retry' then false
      when v_assignment_context = 'drill' then false
      when prior.last_submitted_at is null then true
      when now() - prior.last_submitted_at >= interval '7 days' then true
      else false
    end,
    case
      when input.response_state = 'blank' then 'blank'
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
  order by input.problem_id, coalesce(nullif(btrim(input.sub_label), ''), '');

  return query select v_session_id, false, v_attempt_count;
end;
$$;

revoke all on function learning.submit_session_v2(uuid, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function learning.submit_session_v2(uuid, uuid, uuid, jsonb, jsonb)
  to service_role;

-- All student writes now flow through the authenticated Grade App server route.
revoke insert on table learning.sessions from authenticated;
revoke insert on table learning.attempts from authenticated;
