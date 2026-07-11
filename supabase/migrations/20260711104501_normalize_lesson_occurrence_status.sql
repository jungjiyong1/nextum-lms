-- Store only operational exceptions. Upcoming/completed is derived from the
-- lesson date and end time in the application instead of persisted as state.

set lock_timeout = '5s';
set statement_timeout = '30s';

create or replace function private.canonicalize_lesson_occurrence_status_v1()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if new.status in ('scheduled', 'completed') then
    new.status := 'normal';
  end if;
  return new;
end;
$$;

revoke all on function private.canonicalize_lesson_occurrence_status_v1()
  from public, anon, authenticated;

drop trigger if exists canonicalize_lesson_occurrence_status
  on lms.lesson_occurrences;
create trigger canonicalize_lesson_occurrence_status
before insert or update of status on lms.lesson_occurrences
for each row execute function private.canonicalize_lesson_occurrence_status_v1();

alter table lms.lesson_occurrences
  drop constraint if exists lesson_occurrences_status_check;

update lms.lesson_occurrences
set status = 'normal'
where status in ('scheduled', 'completed');

alter table lms.lesson_occurrences
  alter column status set default 'normal';

alter table lms.lesson_occurrences
  add constraint lesson_occurrences_status_check
  check (status in ('normal', 'cancelled', 'makeup', 'substitute'))
  not valid;

alter table lms.lesson_occurrences
  validate constraint lesson_occurrences_status_check;

do $$
begin
  if exists (
    select 1
    from lms.lesson_occurrences
    where status in ('scheduled', 'completed')
  ) then
    raise exception 'Legacy lesson occurrence statuses remain after canonicalization.';
  end if;
end;
$$;

create or replace function lms.convert_single_schedule_to_recurring_v1(
  p_academy_id uuid,
  p_class_id uuid,
  p_occurrence_id uuid,
  p_day_of_week integer,
  p_start_date date,
  p_end_date date,
  p_interval_weeks integer,
  p_start_time time,
  p_end_time time,
  p_instructor_id uuid,
  p_classroom_id uuid,
  p_conflict_override_reason text,
  p_conflict_override_allowed boolean,
  p_actor_person_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_occurrence lms.lesson_occurrences%rowtype;
  v_result jsonb;
  v_rule_id uuid;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'Schedule conversion is server-only.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_academy_id::text, 1127));

  select occurrence.*
  into v_occurrence
  from lms.lesson_occurrences occurrence
  where occurrence.id = p_occurrence_id
    and occurrence.academy_id = p_academy_id
    and occurrence.class_id = p_class_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'One-time lesson does not belong to the class.';
  end if;
  if v_occurrence.rule_id is not null then
    raise exception using errcode = '22023', message = 'Only a one-time lesson can be converted to a recurring schedule.';
  end if;
  if v_occurrence.status <> 'normal' then
    raise exception using errcode = '22023', message = 'Only a normal one-time lesson can be converted.';
  end if;
  if exists (
    select 1
    from lms.attendance_records record
    where record.occurrence_id = v_occurrence.id
  ) then
    raise exception using errcode = '23503', message = 'A lesson with attendance cannot be converted.';
  end if;
  if not private.schedule_date_matches_rule_v1(
    v_occurrence.occurrence_date,
    p_day_of_week,
    p_start_date,
    p_end_date,
    greatest(coalesce(p_interval_weeks, 1), 1)
  ) then
    raise exception using errcode = '22023', message = 'The original lesson date must be the first recurring lesson date.';
  end if;

  select lms.mutate_schedule_v1(
    p_academy_id => p_academy_id,
    p_kind => 'recurring',
    p_scope => 'all',
    p_class_id => p_class_id,
    p_rule_id => null,
    p_occurrence_id => p_occurrence_id,
    p_date => null,
    p_day_of_week => p_day_of_week,
    p_start_date => p_start_date,
    p_end_date => p_end_date,
    p_interval_weeks => greatest(coalesce(p_interval_weeks, 1), 1),
    p_start_time => p_start_time,
    p_end_time => p_end_time,
    p_instructor_id => p_instructor_id,
    p_classroom_id => p_classroom_id,
    p_substitute_instructor_id => null,
    p_status => 'normal',
    p_cancel_reason => null,
    p_notes => null,
    p_conflict_override_reason => p_conflict_override_reason,
    p_conflict_override_allowed => p_conflict_override_allowed,
    p_actor_person_id => p_actor_person_id
  ) into v_result;

  v_rule_id := nullif(v_result ->> 'id', '')::uuid;
  if v_rule_id is null then
    raise exception using errcode = 'P0001', message = 'Recurring schedule creation did not return a rule.';
  end if;

  update lms.lesson_occurrences
  set rule_id = v_rule_id,
      start_time = p_start_time,
      end_time = p_end_time,
      classroom_id = p_classroom_id,
      instructor_staff_id = p_instructor_id,
      substitute_staff_id = null,
      cancel_reason = null,
      override_scope = null,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'convertedToRecurringAt', now(),
        'convertedToRecurringBy', p_actor_person_id
      )
  where id = v_occurrence.id
    and academy_id = p_academy_id;

  return v_result || jsonb_build_object('convertedOccurrenceId', v_occurrence.id);
end;
$$;

revoke all on function lms.convert_single_schedule_to_recurring_v1(
  uuid, uuid, uuid, integer, date, date, integer, time, time, uuid, uuid, text, boolean, uuid
) from public, anon, authenticated;
grant execute on function lms.convert_single_schedule_to_recurring_v1(
  uuid, uuid, uuid, integer, date, date, integer, time, time, uuid, uuid, text, boolean, uuid
) to service_role;

comment on column lms.lesson_occurrences.status is
  'Operational lesson state: normal, cancelled, makeup, or substitute. Completion is derived from occurrence_date and end_time.';
comment on function private.canonicalize_lesson_occurrence_status_v1() is
  'Maps legacy scheduled/completed writes to the canonical normal lesson state.';

notify pgrst, 'reload schema';
