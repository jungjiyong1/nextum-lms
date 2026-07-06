-- Student archive/delete support and immutable accounting name snapshots.
-- Remote migration version: 20260706092750.

alter table lms.invoices
  add column if not exists student_name_snapshot text;

alter table lms.payments
  add column if not exists student_name_snapshot text,
  add column if not exists payer_name_snapshot text;

update lms.invoices i
   set student_name_snapshot = coalesce(i.student_name_snapshot, pe.display_name, pe.full_name, 'Unknown student')
  from core.students s
  join core.people pe on pe.id = s.person_id
 where i.student_id = s.id
   and i.academy_id = s.academy_id
   and i.student_name_snapshot is null;

update lms.payments p
   set student_name_snapshot = coalesce(p.student_name_snapshot, pe.display_name, pe.full_name, 'Unknown student'),
       payer_name_snapshot = coalesce(p.payer_name_snapshot, pe.display_name, pe.full_name, 'Unknown payer')
  from core.students s
  join core.people pe on pe.id = s.person_id
 where p.student_id = s.id
   and p.academy_id = s.academy_id
   and (p.student_name_snapshot is null or p.payer_name_snapshot is null);

create or replace function lms.archive_student(
  p_academy_id uuid,
  p_student_id uuid,
  p_actor_person_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_person_id uuid;
  v_student_name text;
  v_affected integer;
  v_tables jsonb := '[]'::jsonb;
begin
  select s.person_id, coalesce(pe.display_name, pe.full_name, 'Unknown student')
    into v_person_id, v_student_name
    from core.students s
    join core.people pe on pe.id = s.person_id
   where s.academy_id = p_academy_id
     and s.id = p_student_id;

  if v_person_id is null then
    raise exception 'Selected student does not belong to this academy.';
  end if;

  update core.class_students
     set status = 'dropped',
         primary_class = false,
         ended_at = now()
   where student_id = p_student_id
     and status in ('active', 'pending', 'on_leave');
  get diagnostics v_affected = row_count;
  v_tables := v_tables || jsonb_build_array(jsonb_build_object(
    'schema', 'core',
    'table', 'class_students',
    'operation', 'archive',
    'affectedRows', v_affected
  ));

  update lms.student_billing_contracts
     set status = 'archived',
         effective_to = current_date
   where academy_id = p_academy_id
     and student_id = p_student_id
     and status in ('active', 'inactive');
  get diagnostics v_affected = row_count;
  v_tables := v_tables || jsonb_build_array(jsonb_build_object(
    'schema', 'lms',
    'table', 'student_billing_contracts',
    'operation', 'archive',
    'affectedRows', v_affected
  ));

  update core.academy_members
     set active = false
   where academy_id = p_academy_id
     and person_id = v_person_id
     and role = 'student'
     and active = true;
  get diagnostics v_affected = row_count;
  v_tables := v_tables || jsonb_build_array(jsonb_build_object(
    'schema', 'core',
    'table', 'academy_members',
    'operation', 'deactivate',
    'affectedRows', v_affected
  ));

  update core.account_invitations
     set expires_at = now()
   where academy_id = p_academy_id
     and accepted_at is null
     and (student_id = p_student_id or person_id = v_person_id)
     and expires_at > now();
  get diagnostics v_affected = row_count;
  v_tables := v_tables || jsonb_build_array(jsonb_build_object(
    'schema', 'core',
    'table', 'account_invitations',
    'operation', 'expire',
    'affectedRows', v_affected
  ));

  update core.students
     set status = 'dropped'
   where academy_id = p_academy_id
     and id = p_student_id
     and status <> 'dropped';
  get diagnostics v_affected = row_count;
  v_tables := v_tables || jsonb_build_array(jsonb_build_object(
    'schema', 'core',
    'table', 'students',
    'operation', 'archive',
    'affectedRows', v_affected
  ));

  insert into audit.admin_actions (academy_id, actor_id, action, target, payload)
  values (
    p_academy_id,
    p_actor_person_id,
    'lms.student.archive',
    p_student_id::text,
    jsonb_build_object('studentId', p_student_id, 'studentName', v_student_name, 'tables', v_tables)
  );

  return jsonb_build_object(
    'studentId', p_student_id,
    'studentName', v_student_name,
    'tables', v_tables,
    'totalAffectedRows',
    coalesce((select sum((item->>'affectedRows')::integer) from jsonb_array_elements(v_tables) item), 0)
  );
end;
$$;

create or replace function lms.hard_delete_student_preview(
  p_academy_id uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_person_id uuid;
  v_student_name text;
  v_blockers jsonb := '[]'::jsonb;
  v_historical_total integer := 0;
  v_shared_identity_count integer := 0;
  v_count integer;
begin
  select s.person_id, coalesce(pe.display_name, pe.full_name, 'Unknown student')
    into v_person_id, v_student_name
    from core.students s
    join core.people pe on pe.id = s.person_id
   where s.academy_id = p_academy_id
     and s.id = p_student_id;

  if v_person_id is null then
    raise exception 'Selected student does not belong to this academy.';
  end if;

  select count(*) into v_count from lms.invoices where academy_id = p_academy_id and student_id = p_student_id;
  v_historical_total := v_historical_total + v_count;
  v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('key', 'invoices', 'label', 'Invoices', 'count', v_count));

  select count(*) into v_count from lms.payments where academy_id = p_academy_id and student_id = p_student_id;
  v_historical_total := v_historical_total + v_count;
  v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('key', 'payments', 'label', 'Payments', 'count', v_count));

  select count(*) into v_count from lms.attendance_records where academy_id = p_academy_id and student_id = p_student_id;
  v_historical_total := v_historical_total + v_count;
  v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('key', 'attendance', 'label', 'Attendance records', 'count', v_count));

  select count(*) into v_count from learning.sessions where academy_id = p_academy_id and core_student_id = p_student_id;
  v_historical_total := v_historical_total + v_count;
  v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('key', 'learning_sessions', 'label', 'Learning sessions', 'count', v_count));

  select count(*) into v_count from learning.attempts where academy_id = p_academy_id and core_student_id = p_student_id;
  v_historical_total := v_historical_total + v_count;
  v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('key', 'learning_attempts', 'label', 'Learning attempts', 'count', v_count));

  select count(*) into v_count from learning.wrong_notes where academy_id = p_academy_id and core_student_id = p_student_id;
  v_historical_total := v_historical_total + v_count;
  v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('key', 'wrong_notes', 'label', 'Wrong notes', 'count', v_count));

  select count(*) into v_count from learning.reports where academy_id = p_academy_id and core_student_id = p_student_id;
  v_historical_total := v_historical_total + v_count;
  v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('key', 'reports', 'label', 'Reports', 'count', v_count));

  select count(*) into v_count from ai.conversations where academy_id = p_academy_id and student_id = p_student_id;
  v_historical_total := v_historical_total + v_count;
  v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('key', 'ai_conversations', 'label', 'AI conversations', 'count', v_count));

  select count(*) into v_count from content.problem_reports where academy_id = p_academy_id and core_student_id = p_student_id;
  v_historical_total := v_historical_total + v_count;
  v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('key', 'problem_reports', 'label', 'Problem reports', 'count', v_count));

  select count(*) into v_count from data.events where academy_id = p_academy_id and student_id = p_student_id;
  v_historical_total := v_historical_total + v_count;
  v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('key', 'data_events', 'label', 'Data events', 'count', v_count));

  select
    (
      (select count(*) from core.students where person_id = v_person_id and id <> p_student_id)
      + (select count(*) from core.staff_members where person_id = v_person_id)
      + (
        select count(*)
          from core.academy_members
         where person_id = v_person_id
           and not (academy_id = p_academy_id and role in ('student', 'guardian'))
      )
    )
    into v_shared_identity_count;

  v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
    'key', 'shared_identity',
    'label', 'Shared identity links',
    'count', v_shared_identity_count
  ));

  return jsonb_build_object(
    'studentId', p_student_id,
    'studentName', v_student_name,
    'canHardDelete', v_historical_total = 0 and v_shared_identity_count = 0,
    'historicalRecordCount', v_historical_total,
    'sharedIdentityCount', v_shared_identity_count,
    'blockers', v_blockers
  );
end;
$$;

create or replace function lms.hard_delete_student(
  p_academy_id uuid,
  p_student_id uuid,
  p_actor_person_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_preview jsonb;
  v_person_id uuid;
  v_student_name text;
  v_auth_user_ids jsonb := '[]'::jsonb;
  v_affected integer;
  v_tables jsonb := '[]'::jsonb;
begin
  v_preview := lms.hard_delete_student_preview(p_academy_id, p_student_id);

  if coalesce((v_preview->>'canHardDelete')::boolean, false) is not true then
    raise exception 'This student has historical records or shared identity links and can only be archived.';
  end if;

  select s.person_id, coalesce(pe.display_name, pe.full_name, 'Unknown student')
    into v_person_id, v_student_name
    from core.students s
    join core.people pe on pe.id = s.person_id
   where s.academy_id = p_academy_id
     and s.id = p_student_id;

  select coalesce(jsonb_agg(distinct ua.auth_user_id) filter (where ua.auth_user_id is not null), '[]'::jsonb)
    into v_auth_user_ids
    from core.user_accounts ua
   where ua.person_id = v_person_id;

  delete from core.account_invitations
   where academy_id = p_academy_id
     and (student_id = p_student_id or person_id = v_person_id);
  get diagnostics v_affected = row_count;
  v_tables := v_tables || jsonb_build_array(jsonb_build_object(
    'schema', 'core',
    'table', 'account_invitations',
    'operation', 'delete',
    'affectedRows', v_affected
  ));

  delete from core.academy_members
   where academy_id = p_academy_id
     and person_id = v_person_id
     and role in ('student', 'guardian');
  get diagnostics v_affected = row_count;
  v_tables := v_tables || jsonb_build_array(jsonb_build_object(
    'schema', 'core',
    'table', 'academy_members',
    'operation', 'delete',
    'affectedRows', v_affected
  ));

  delete from core.people
   where id = v_person_id;
  get diagnostics v_affected = row_count;
  v_tables := v_tables || jsonb_build_array(jsonb_build_object(
    'schema', 'core',
    'table', 'people',
    'operation', 'delete',
    'affectedRows', v_affected
  ));

  insert into audit.admin_actions (academy_id, actor_id, action, target, payload)
  values (
    p_academy_id,
    p_actor_person_id,
    'lms.student.hard_delete',
    p_student_id::text,
    jsonb_build_object('studentId', p_student_id, 'studentName', v_student_name, 'tables', v_tables)
  );

  return jsonb_build_object(
    'studentId', p_student_id,
    'studentName', v_student_name,
    'authUserIds', v_auth_user_ids,
    'tables', v_tables,
    'totalAffectedRows',
    coalesce((select sum((item->>'affectedRows')::integer) from jsonb_array_elements(v_tables) item), 0)
  );
end;
$$;

revoke all on function lms.archive_student(uuid, uuid, uuid) from public;
revoke all on function lms.hard_delete_student_preview(uuid, uuid) from public;
revoke all on function lms.hard_delete_student(uuid, uuid, uuid) from public;

grant execute on function lms.archive_student(uuid, uuid, uuid) to service_role;
grant execute on function lms.hard_delete_student_preview(uuid, uuid) to service_role;
grant execute on function lms.hard_delete_student(uuid, uuid, uuid) to service_role;
