-- Recurrence-aware schedule deletion and atomic one-time to recurring conversion.

create index if not exists lms_occurrences_rule_date_idx
  on lms.lesson_occurrences (academy_id, rule_id, occurrence_date)
  where rule_id is not null;

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
  if v_occurrence.status <> 'scheduled' then
    raise exception using errcode = '22023', message = 'Only a scheduled one-time lesson can be converted.';
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
    p_status => 'scheduled',
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

create or replace function lms.delete_schedule_v1(
  p_academy_id uuid,
  p_class_id uuid,
  p_rule_id uuid,
  p_occurrence_id uuid,
  p_date date,
  p_scope text,
  p_actor_person_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_rule lms.class_schedule_rules%rowtype;
  v_occurrence lms.lesson_occurrences%rowtype;
  v_has_occurrence boolean := false;
  v_removed integer := 0;
  v_preserved integer := 0;
  v_delete_marker constant text := '__nextum_schedule_deleted__';
  v_delete_metadata jsonb := jsonb_build_object(
    'scheduleDeleted', true,
    'scheduleDeletedAt', now(),
    'scheduleDeletedBy', p_actor_person_id
  );
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'Schedule deletion is server-only.';
  end if;
  if p_scope not in ('single', 'future', 'all') then
    raise exception using errcode = '22023', message = 'Invalid schedule deletion scope.';
  end if;
  if not exists (
    select 1
    from core.classes class_row
    where class_row.id = p_class_id
      and class_row.academy_id = p_academy_id
  ) then
    raise exception using errcode = '22023', message = 'Class does not belong to the academy.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_academy_id::text, 1127));

  if p_rule_id is null then
    if p_scope <> 'single' or p_occurrence_id is null then
      raise exception using errcode = '22023', message = 'One-time schedule deletion requires a lesson occurrence.';
    end if;

    select occurrence.*
    into v_occurrence
    from lms.lesson_occurrences occurrence
    where occurrence.id = p_occurrence_id
      and occurrence.academy_id = p_academy_id
      and occurrence.class_id = p_class_id
    for update;

    if not found then
      raise exception using errcode = '22023', message = 'Lesson occurrence does not belong to the class.';
    end if;
    if v_occurrence.rule_id is not null then
      raise exception using errcode = '22023', message = 'Recurring lesson deletion requires its schedule rule.';
    end if;
    if exists (
      select 1
      from lms.attendance_records record
      where record.occurrence_id = v_occurrence.id
    ) then
      raise exception using errcode = '23503', message = 'A lesson with attendance cannot be deleted.';
    end if;

    delete from lms.lesson_occurrences occurrence
    where occurrence.id = v_occurrence.id
      and occurrence.academy_id = p_academy_id;

    return jsonb_build_object(
      'kind', 'single',
      'id', v_occurrence.id,
      'scope', 'single',
      'removedOccurrences', 1,
      'preservedOccurrences', 0
    );
  end if;

  select rule.*
  into v_rule
  from lms.class_schedule_rules rule
  where rule.id = p_rule_id
    and rule.academy_id = p_academy_id
    and rule.class_id = p_class_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'Schedule rule does not belong to the class.';
  end if;
  if p_scope in ('single', 'future') and p_date is null then
    raise exception using errcode = '22023', message = 'A schedule date is required for this deletion scope.';
  end if;

  if p_scope = 'single' then
    if p_occurrence_id is not null then
      select occurrence.*
      into v_occurrence
      from lms.lesson_occurrences occurrence
      where occurrence.id = p_occurrence_id
        and occurrence.academy_id = p_academy_id
        and occurrence.class_id = p_class_id
        and occurrence.rule_id = p_rule_id
      for update;
      v_has_occurrence := found;
      if not v_has_occurrence then
        raise exception using errcode = '22023', message = 'Recurring lesson occurrence does not belong to the rule.';
      end if;
    else
      if not private.schedule_date_matches_rule_v1(
        p_date,
        v_rule.day_of_week,
        v_rule.start_date,
        v_rule.end_date,
        v_rule.interval_weeks
      ) then
        raise exception using errcode = '22023', message = 'The selected date is not part of the recurring schedule.';
      end if;

      select occurrence.*
      into v_occurrence
      from lms.lesson_occurrences occurrence
      where occurrence.academy_id = p_academy_id
        and occurrence.class_id = p_class_id
        and occurrence.rule_id = p_rule_id
        and occurrence.occurrence_date = p_date
      order by occurrence.created_at, occurrence.id
      limit 1
      for update;
      v_has_occurrence := found;
    end if;

    if v_has_occurrence then
      if exists (
        select 1
        from lms.attendance_records record
        where record.occurrence_id = v_occurrence.id
      ) then
        raise exception using errcode = '23503', message = 'A lesson with attendance cannot be deleted.';
      end if;

      update lms.lesson_occurrences
      set status = 'cancelled',
          cancel_reason = v_delete_marker,
          substitute_staff_id = null,
          override_scope = 'single',
          metadata = coalesce(metadata, '{}'::jsonb) || v_delete_metadata
      where id = v_occurrence.id
        and academy_id = p_academy_id;
    else
      insert into lms.lesson_occurrences (
        academy_id,
        class_id,
        rule_id,
        occurrence_date,
        start_time,
        end_time,
        status,
        classroom_id,
        instructor_staff_id,
        cancel_reason,
        override_scope,
        metadata
      ) values (
        p_academy_id,
        p_class_id,
        p_rule_id,
        p_date,
        v_rule.start_time,
        v_rule.end_time,
        'cancelled',
        v_rule.classroom_id,
        v_rule.instructor_staff_id,
        v_delete_marker,
        'single',
        v_delete_metadata
      )
      returning * into v_occurrence;
    end if;

    return jsonb_build_object(
      'kind', 'recurring',
      'id', p_rule_id,
      'occurrenceId', v_occurrence.id,
      'scope', 'single',
      'removedOccurrences', 1,
      'preservedOccurrences', 0
    );
  end if;

  if p_scope = 'future' then
    update lms.class_schedule_rules
    set active = case when p_date <= start_date then false else active end,
        end_date = case
          when p_date <= start_date then end_date
          else least(coalesce(end_date, p_date - 1), p_date - 1)
        end,
        metadata = coalesce(metadata, '{}'::jsonb) || v_delete_metadata || jsonb_build_object(
          'scheduleDeleteScope', 'future',
          'scheduleDeleteFrom', p_date
        )
    where id = p_rule_id
      and academy_id = p_academy_id;

    delete from lms.lesson_occurrences occurrence
    where occurrence.academy_id = p_academy_id
      and occurrence.rule_id = p_rule_id
      and occurrence.occurrence_date >= p_date
      and not exists (
        select 1
        from lms.attendance_records record
        where record.occurrence_id = occurrence.id
      );
    get diagnostics v_removed = row_count;

    select count(*)::integer
    into v_preserved
    from lms.lesson_occurrences occurrence
    where occurrence.academy_id = p_academy_id
      and occurrence.rule_id = p_rule_id
      and occurrence.occurrence_date >= p_date
      and exists (
        select 1
        from lms.attendance_records record
        where record.occurrence_id = occurrence.id
      );
  else
    update lms.class_schedule_rules
    set active = false,
        metadata = coalesce(metadata, '{}'::jsonb) || v_delete_metadata || jsonb_build_object(
          'scheduleDeleteScope', 'all'
        )
    where id = p_rule_id
      and academy_id = p_academy_id;

    delete from lms.lesson_occurrences occurrence
    where occurrence.academy_id = p_academy_id
      and occurrence.rule_id = p_rule_id
      and not exists (
        select 1
        from lms.attendance_records record
        where record.occurrence_id = occurrence.id
      );
    get diagnostics v_removed = row_count;

    select count(*)::integer
    into v_preserved
    from lms.lesson_occurrences occurrence
    where occurrence.academy_id = p_academy_id
      and occurrence.rule_id = p_rule_id
      and exists (
        select 1
        from lms.attendance_records record
        where record.occurrence_id = occurrence.id
      );
  end if;

  return jsonb_build_object(
    'kind', 'recurring',
    'id', p_rule_id,
    'scope', p_scope,
    'removedOccurrences', v_removed,
    'preservedOccurrences', v_preserved
  );
end;
$$;

revoke all on function lms.convert_single_schedule_to_recurring_v1(
  uuid, uuid, uuid, integer, date, date, integer, time, time, uuid, uuid, text, boolean, uuid
) from public, anon, authenticated;
revoke all on function lms.delete_schedule_v1(
  uuid, uuid, uuid, uuid, date, text, uuid
) from public, anon, authenticated;

grant execute on function lms.convert_single_schedule_to_recurring_v1(
  uuid, uuid, uuid, integer, date, date, integer, time, time, uuid, uuid, text, boolean, uuid
) to service_role;
grant execute on function lms.delete_schedule_v1(
  uuid, uuid, uuid, uuid, date, text, uuid
) to service_role;

comment on function lms.convert_single_schedule_to_recurring_v1(
  uuid, uuid, uuid, integer, date, date, integer, time, time, uuid, uuid, text, boolean, uuid
) is 'Atomically converts an unrecorded one-time lesson into the first occurrence of a recurring schedule.';
comment on function lms.delete_schedule_v1(
  uuid, uuid, uuid, uuid, date, text, uuid
) is 'Deletes one-time schedules or excludes/ends recurring schedules while preserving attendance history.';
