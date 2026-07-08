-- Staff archive/delete support and immutable payroll recipient snapshots.

update lms.instructor_payments ip
   set recipient_name = coalesce(ip.recipient_name, pe.display_name, pe.full_name, 'Unknown staff')
  from core.staff_members sm
  join core.people pe on pe.id = sm.person_id
 where ip.instructor_id = sm.id
   and ip.academy_id = sm.academy_id
   and ip.recipient_name is null;

create or replace function lms.archive_staff_member(
  p_academy_id uuid,
  p_staff_id uuid,
  p_actor_person_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_person_id uuid;
  v_staff_name text;
  v_role text;
  v_affected integer;
  v_tables jsonb := '[]'::jsonb;
begin
  select sm.person_id, sm.role, coalesce(pe.display_name, pe.full_name, 'Unknown staff')
    into v_person_id, v_role, v_staff_name
    from core.staff_members sm
    join core.people pe on pe.id = sm.person_id
   where sm.academy_id = p_academy_id
     and sm.id = p_staff_id;

  if v_person_id is null then
    raise exception 'Selected staff member does not belong to this academy.';
  end if;
  if v_role = 'owner' then
    raise exception 'Owner role cannot be archived here.';
  end if;
  if v_person_id = p_actor_person_id then
    raise exception 'You cannot archive your own staff record.';
  end if;
  if v_role = 'admin' and not exists (
    select 1
      from core.academy_members am
     where am.academy_id = p_academy_id
       and am.active = true
       and am.role in ('owner', 'admin')
       and am.person_id <> v_person_id
  ) then
    raise exception 'At least one active owner/admin must remain.';
  end if;

  update core.staff_members
     set status = 'inactive'
   where academy_id = p_academy_id
     and id = p_staff_id
     and status <> 'inactive';
  get diagnostics v_affected = row_count;
  v_tables := v_tables || jsonb_build_array(jsonb_build_object(
    'schema', 'core',
    'table', 'staff_members',
    'operation', 'archive',
    'affectedRows', v_affected
  ));

  update core.academy_members
     set active = false
   where academy_id = p_academy_id
     and person_id = v_person_id
     and role = v_role
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
     and (staff_member_id = p_staff_id or person_id = v_person_id)
     and expires_at > now();
  get diagnostics v_affected = row_count;
  v_tables := v_tables || jsonb_build_array(jsonb_build_object(
    'schema', 'core',
    'table', 'account_invitations',
    'operation', 'expire',
    'affectedRows', v_affected
  ));

  update lms.class_profiles
     set default_instructor_staff_id = null
   where academy_id = p_academy_id
     and default_instructor_staff_id = p_staff_id;
  get diagnostics v_affected = row_count;
  v_tables := v_tables || jsonb_build_array(jsonb_build_object(
    'schema', 'lms',
    'table', 'class_profiles',
    'operation', 'clear_default_instructor',
    'affectedRows', v_affected
  ));

  update lms.class_schedule_rules
     set active = false,
         end_date = case
           when end_date is null or end_date > current_date then current_date
           else end_date
         end
   where academy_id = p_academy_id
     and instructor_staff_id = p_staff_id
     and active = true;
  get diagnostics v_affected = row_count;
  v_tables := v_tables || jsonb_build_array(jsonb_build_object(
    'schema', 'lms',
    'table', 'class_schedule_rules',
    'operation', 'close',
    'affectedRows', v_affected
  ));

  update lms.lesson_occurrences
     set instructor_staff_id = case when instructor_staff_id = p_staff_id then null else instructor_staff_id end,
         substitute_staff_id = case when substitute_staff_id = p_staff_id then null else substitute_staff_id end
   where academy_id = p_academy_id
     and occurrence_date >= current_date
     and (instructor_staff_id = p_staff_id or substitute_staff_id = p_staff_id);
  get diagnostics v_affected = row_count;
  v_tables := v_tables || jsonb_build_array(jsonb_build_object(
    'schema', 'lms',
    'table', 'lesson_occurrences',
    'operation', 'clear_future_instructor',
    'affectedRows', v_affected
  ));

  insert into audit.admin_actions (academy_id, actor_id, action, target, payload)
  values (
    p_academy_id,
    p_actor_person_id,
    'lms.staff.archive',
    p_staff_id::text,
    jsonb_build_object('staffId', p_staff_id, 'staffName', v_staff_name, 'tables', v_tables)
  );

  return jsonb_build_object(
    'staffId', p_staff_id,
    'staffName', v_staff_name,
    'tables', v_tables,
    'totalAffectedRows',
    coalesce((select sum((item->>'affectedRows')::integer) from jsonb_array_elements(v_tables) item), 0)
  );
end;
$$;

create or replace function lms.hard_delete_staff_member_preview(
  p_academy_id uuid,
  p_staff_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_person_id uuid;
  v_staff_name text;
  v_role text;
  v_count integer;
  v_historical_total integer := 0;
  v_shared_identity_count integer := 0;
  v_blockers jsonb := '[]'::jsonb;
begin
  select sm.person_id, sm.role, coalesce(pe.display_name, pe.full_name, 'Unknown staff')
    into v_person_id, v_role, v_staff_name
    from core.staff_members sm
    join core.people pe on pe.id = sm.person_id
   where sm.academy_id = p_academy_id
     and sm.id = p_staff_id;

  if v_person_id is null then
    raise exception 'Selected staff member does not belong to this academy.';
  end if;

  v_count := case when v_role = 'owner' then 1 else 0 end;
  v_historical_total := v_historical_total + v_count;
  v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('key', 'owner_role', 'label', 'Owner role', 'count', v_count));

  select count(*) into v_count from lms.instructor_payments where academy_id = p_academy_id and instructor_id = p_staff_id;
  v_historical_total := v_historical_total + v_count;
  v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('key', 'instructor_payments', 'label', 'Instructor payments', 'count', v_count));

  select count(*) into v_count from lms.class_profiles where academy_id = p_academy_id and default_instructor_staff_id = p_staff_id;
  v_historical_total := v_historical_total + v_count;
  v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('key', 'class_profiles', 'label', 'Default class assignments', 'count', v_count));

  select count(*) into v_count from lms.class_schedule_rules where academy_id = p_academy_id and instructor_staff_id = p_staff_id;
  v_historical_total := v_historical_total + v_count;
  v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('key', 'class_schedule_rules', 'label', 'Schedule rules', 'count', v_count));

  select count(*) into v_count from lms.lesson_occurrences
   where academy_id = p_academy_id
     and (instructor_staff_id = p_staff_id or substitute_staff_id = p_staff_id);
  v_historical_total := v_historical_total + v_count;
  v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('key', 'lesson_occurrences', 'label', 'Lesson occurrences', 'count', v_count));

  select count(*) into v_count from core.account_invitations
   where academy_id = p_academy_id
     and (staff_member_id = p_staff_id or person_id = v_person_id);
  v_historical_total := v_historical_total + v_count;
  v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('key', 'account_invitations', 'label', 'Account invitations', 'count', v_count));

  select
    (
      (select count(*) from core.staff_members where person_id = v_person_id and id <> p_staff_id)
      + (select count(*) from core.students where person_id = v_person_id)
      + (select count(*) from core.user_accounts where person_id = v_person_id)
      + (select count(*) from core.academy_members where academy_id = p_academy_id and person_id = v_person_id)
    )
    into v_shared_identity_count;

  v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
    'key', 'shared_identity',
    'label', 'Shared identity links',
    'count', v_shared_identity_count
  ));

  return jsonb_build_object(
    'staffId', p_staff_id,
    'staffName', v_staff_name,
    'canHardDelete', v_historical_total = 0 and v_shared_identity_count = 0,
    'historicalRecordCount', v_historical_total,
    'sharedIdentityCount', v_shared_identity_count,
    'blockers', v_blockers
  );
end;
$$;

create or replace function lms.hard_delete_staff_member(
  p_academy_id uuid,
  p_staff_id uuid,
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
  v_staff_name text;
  v_affected integer;
  v_tables jsonb := '[]'::jsonb;
begin
  v_preview := lms.hard_delete_staff_member_preview(p_academy_id, p_staff_id);

  if coalesce((v_preview->>'canHardDelete')::boolean, false) is not true then
    raise exception 'This staff member has historical records or shared identity links and can only be archived.';
  end if;

  select sm.person_id, coalesce(pe.display_name, pe.full_name, 'Unknown staff')
    into v_person_id, v_staff_name
    from core.staff_members sm
    join core.people pe on pe.id = sm.person_id
   where sm.academy_id = p_academy_id
     and sm.id = p_staff_id;

  delete from core.staff_members
   where academy_id = p_academy_id
     and id = p_staff_id;
  get diagnostics v_affected = row_count;
  v_tables := v_tables || jsonb_build_array(jsonb_build_object(
    'schema', 'core',
    'table', 'staff_members',
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
    'lms.staff.hard_delete',
    p_staff_id::text,
    jsonb_build_object('staffId', p_staff_id, 'staffName', v_staff_name, 'tables', v_tables)
  );

  return jsonb_build_object(
    'staffId', p_staff_id,
    'staffName', v_staff_name,
    'tables', v_tables,
    'totalAffectedRows',
    coalesce((select sum((item->>'affectedRows')::integer) from jsonb_array_elements(v_tables) item), 0)
  );
end;
$$;

revoke all on function lms.archive_staff_member(uuid, uuid, uuid) from public;
revoke all on function lms.hard_delete_staff_member_preview(uuid, uuid) from public;
revoke all on function lms.hard_delete_staff_member(uuid, uuid, uuid) from public;

grant execute on function lms.archive_staff_member(uuid, uuid, uuid) to service_role;
grant execute on function lms.hard_delete_staff_member_preview(uuid, uuid) to service_role;
grant execute on function lms.hard_delete_staff_member(uuid, uuid, uuid) to service_role;
