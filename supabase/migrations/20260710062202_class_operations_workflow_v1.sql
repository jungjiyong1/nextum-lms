-- Contextual class operations: recurrence-safe schedule mutation, class roster
-- billing changes, and batch attendance recording.

create or replace function private.gcd_int_v1(p_left integer, p_right integer)
returns integer
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_left integer := abs(coalesce(p_left, 0));
  v_right integer := abs(coalesce(p_right, 0));
  v_swap integer;
begin
  while v_right <> 0 loop
    v_swap := v_left % v_right;
    v_left := v_right;
    v_right := v_swap;
  end loop;
  return greatest(v_left, 1);
end;
$$;

create or replace function private.schedule_rule_anchor_v1(
  p_start_date date,
  p_day_of_week integer
)
returns date
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_start_date + (
    (p_day_of_week - (extract(isodow from p_start_date)::integer - 1) + 7) % 7
  );
$$;

create or replace function private.schedule_date_matches_rule_v1(
  p_date date,
  p_day_of_week integer,
  p_start_date date,
  p_end_date date,
  p_interval_weeks integer
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_date is not null
    and p_start_date is not null
    and p_day_of_week between 0 and 6
    and p_date >= private.schedule_rule_anchor_v1(p_start_date, p_day_of_week)
    and (p_end_date is null or p_date <= p_end_date)
    and (extract(isodow from p_date)::integer - 1) = p_day_of_week
    and (
      ((p_date - private.schedule_rule_anchor_v1(p_start_date, p_day_of_week)) / 7)
      % greatest(coalesce(p_interval_weeks, 1), 1)
    ) = 0;
$$;

create or replace function private.schedule_rules_overlap_v1(
  p_left_day integer,
  p_left_start date,
  p_left_end date,
  p_left_interval integer,
  p_right_day integer,
  p_right_start date,
  p_right_end date,
  p_right_interval integer
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_left_anchor date;
  v_right_anchor date;
  v_lower date;
  v_upper date;
  v_scan_end date;
  v_left_interval integer := greatest(coalesce(p_left_interval, 1), 1);
  v_right_interval integer := greatest(coalesce(p_right_interval, 1), 1);
  v_lcm integer;
begin
  if p_left_day is distinct from p_right_day then
    return false;
  end if;

  v_left_anchor := private.schedule_rule_anchor_v1(p_left_start, p_left_day);
  v_right_anchor := private.schedule_rule_anchor_v1(p_right_start, p_right_day);
  v_lower := greatest(v_left_anchor, v_right_anchor);

  if p_left_end is not null and p_right_end is not null then
    v_upper := least(p_left_end, p_right_end);
  else
    v_upper := coalesce(p_left_end, p_right_end);
  end if;

  if v_upper is not null and v_lower > v_upper then
    return false;
  end if;

  v_lcm := (v_left_interval / private.gcd_int_v1(v_left_interval, v_right_interval)) * v_right_interval;
  v_scan_end := v_lower + (7 * greatest(v_lcm, 1));
  if v_upper is not null then
    v_scan_end := least(v_scan_end, v_upper);
  end if;

  return exists (
    select 1
    from generate_series(v_lower, v_scan_end, interval '7 days') candidate(day_value)
    where private.schedule_date_matches_rule_v1(
      candidate.day_value::date,
      p_left_day,
      p_left_start,
      p_left_end,
      v_left_interval
    )
      and private.schedule_date_matches_rule_v1(
        candidate.day_value::date,
        p_right_day,
        p_right_start,
        p_right_end,
        v_right_interval
      )
  );
end;
$$;

create or replace function lms.schedule_conflicts_v1(
  p_academy_id uuid,
  p_kind text,
  p_class_id uuid,
  p_rule_id uuid,
  p_occurrence_id uuid,
  p_date date,
  p_day_of_week integer,
  p_start_date date,
  p_end_date date,
  p_interval_weeks integer,
  p_start_time time,
  p_end_time time,
  p_instructor_id uuid,
  p_classroom_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_conflicts jsonb := '[]'::jsonb;
  v_instructor_id uuid;
  v_classroom_id uuid;
  v_row record;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'Schedule conflict checks are server-only.';
  end if;
  if p_kind not in ('recurring', 'single')
     or p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
    raise exception using errcode = '22023', message = 'Invalid schedule conflict request.';
  end if;
  if not exists (
    select 1 from core.classes c
    where c.id = p_class_id and c.academy_id = p_academy_id
  ) then
    raise exception using errcode = '22023', message = 'Class does not belong to the academy.';
  end if;

  v_instructor_id := p_instructor_id;
  v_classroom_id := p_classroom_id;
  select
    coalesce(v_instructor_id, cp.default_instructor_staff_id),
    coalesce(v_classroom_id, cp.default_classroom_id)
  into v_instructor_id, v_classroom_id
  from lms.class_profiles cp
  where cp.academy_id = p_academy_id and cp.class_id = p_class_id;

  for v_row in
    select
      'rule'::text as source,
      rule.id,
      rule.class_id,
      c.name as class_name,
      null::date as occurrence_date,
      rule.day_of_week,
      rule.start_time,
      rule.end_time,
      coalesce(rule.instructor_staff_id, cp.default_instructor_staff_id) as instructor_id,
      coalesce(person.display_name, person.full_name) as instructor_name,
      coalesce(rule.classroom_id, cp.default_classroom_id) as classroom_id,
      classroom.name as classroom_name
    from lms.class_schedule_rules rule
    join core.classes c on c.id = rule.class_id and c.academy_id = p_academy_id
    left join lms.class_profiles cp on cp.class_id = rule.class_id
    left join core.staff_members staff
      on staff.id = coalesce(rule.instructor_staff_id, cp.default_instructor_staff_id)
    left join core.people person on person.id = staff.person_id
    left join lms.classrooms classroom
      on classroom.id = coalesce(rule.classroom_id, cp.default_classroom_id)
    where rule.academy_id = p_academy_id
      and rule.active
      and (p_rule_id is null or rule.id <> p_rule_id)
      and rule.start_time < p_end_time
      and rule.end_time > p_start_time
      and (
        (p_kind = 'recurring' and private.schedule_rules_overlap_v1(
          p_day_of_week,
          p_start_date,
          p_end_date,
          p_interval_weeks,
          rule.day_of_week,
          rule.start_date,
          rule.end_date,
          rule.interval_weeks
        ))
        or
        (p_kind = 'single' and private.schedule_date_matches_rule_v1(
          p_date,
          rule.day_of_week,
          rule.start_date,
          rule.end_date,
          rule.interval_weeks
        ) and not exists (
          select 1
          from lms.lesson_occurrences override_row
          where override_row.academy_id = p_academy_id
            and override_row.rule_id = rule.id
            and override_row.occurrence_date = p_date
        ))
      )
  loop
    if v_row.class_id = p_class_id then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'kind', 'class', 'source', v_row.source, 'id', v_row.id,
        'classId', v_row.class_id, 'className', v_row.class_name,
        'date', v_row.occurrence_date, 'dayOfWeek', v_row.day_of_week,
        'startTime', v_row.start_time, 'endTime', v_row.end_time,
        'instructorName', v_row.instructor_name, 'classroomName', v_row.classroom_name
      ));
    end if;
    if v_instructor_id is not null and v_row.instructor_id = v_instructor_id then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'kind', 'instructor', 'source', v_row.source, 'id', v_row.id,
        'classId', v_row.class_id, 'className', v_row.class_name,
        'date', v_row.occurrence_date, 'dayOfWeek', v_row.day_of_week,
        'startTime', v_row.start_time, 'endTime', v_row.end_time,
        'instructorName', v_row.instructor_name, 'classroomName', v_row.classroom_name
      ));
    end if;
    if v_classroom_id is not null and v_row.classroom_id = v_classroom_id then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'kind', 'classroom', 'source', v_row.source, 'id', v_row.id,
        'classId', v_row.class_id, 'className', v_row.class_name,
        'date', v_row.occurrence_date, 'dayOfWeek', v_row.day_of_week,
        'startTime', v_row.start_time, 'endTime', v_row.end_time,
        'instructorName', v_row.instructor_name, 'classroomName', v_row.classroom_name
      ));
    end if;
  end loop;

  for v_row in
    select
      'occurrence'::text as source,
      occurrence.id,
      occurrence.class_id,
      c.name as class_name,
      occurrence.occurrence_date,
      null::integer as day_of_week,
      occurrence.start_time,
      occurrence.end_time,
      coalesce(
        occurrence.substitute_staff_id,
        occurrence.instructor_staff_id,
        cp.default_instructor_staff_id
      ) as instructor_id,
      coalesce(person.display_name, person.full_name) as instructor_name,
      coalesce(occurrence.classroom_id, cp.default_classroom_id) as classroom_id,
      classroom.name as classroom_name
    from lms.lesson_occurrences occurrence
    join core.classes c on c.id = occurrence.class_id and c.academy_id = p_academy_id
    left join lms.class_profiles cp on cp.class_id = occurrence.class_id
    left join core.staff_members staff on staff.id = coalesce(
      occurrence.substitute_staff_id,
      occurrence.instructor_staff_id,
      cp.default_instructor_staff_id
    )
    left join core.people person on person.id = staff.person_id
    left join lms.classrooms classroom
      on classroom.id = coalesce(occurrence.classroom_id, cp.default_classroom_id)
    where occurrence.academy_id = p_academy_id
      and occurrence.status <> 'cancelled'
      and (p_occurrence_id is null or occurrence.id <> p_occurrence_id)
      and (p_kind <> 'recurring' or p_rule_id is null or occurrence.rule_id is distinct from p_rule_id)
      and occurrence.start_time < p_end_time
      and occurrence.end_time > p_start_time
      and (
        (p_kind = 'single' and occurrence.occurrence_date = p_date)
        or
        (p_kind = 'recurring'
          and (occurrence.rule_id is null or occurrence.override_scope is not null)
          and private.schedule_date_matches_rule_v1(
            occurrence.occurrence_date,
            p_day_of_week,
            p_start_date,
            p_end_date,
            p_interval_weeks
          ))
      )
  loop
    if v_row.class_id = p_class_id then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'kind', 'class', 'source', v_row.source, 'id', v_row.id,
        'classId', v_row.class_id, 'className', v_row.class_name,
        'date', v_row.occurrence_date, 'dayOfWeek', v_row.day_of_week,
        'startTime', v_row.start_time, 'endTime', v_row.end_time,
        'instructorName', v_row.instructor_name, 'classroomName', v_row.classroom_name
      ));
    end if;
    if v_instructor_id is not null and v_row.instructor_id = v_instructor_id then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'kind', 'instructor', 'source', v_row.source, 'id', v_row.id,
        'classId', v_row.class_id, 'className', v_row.class_name,
        'date', v_row.occurrence_date, 'dayOfWeek', v_row.day_of_week,
        'startTime', v_row.start_time, 'endTime', v_row.end_time,
        'instructorName', v_row.instructor_name, 'classroomName', v_row.classroom_name
      ));
    end if;
    if v_classroom_id is not null and v_row.classroom_id = v_classroom_id then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'kind', 'classroom', 'source', v_row.source, 'id', v_row.id,
        'classId', v_row.class_id, 'className', v_row.class_name,
        'date', v_row.occurrence_date, 'dayOfWeek', v_row.day_of_week,
        'startTime', v_row.start_time, 'endTime', v_row.end_time,
        'instructorName', v_row.instructor_name, 'classroomName', v_row.classroom_name
      ));
    end if;
  end loop;

  return v_conflicts;
end;
$$;

create or replace function lms.mutate_schedule_v1(
  p_academy_id uuid,
  p_kind text,
  p_scope text,
  p_class_id uuid,
  p_rule_id uuid,
  p_occurrence_id uuid,
  p_date date,
  p_day_of_week integer,
  p_start_date date,
  p_end_date date,
  p_interval_weeks integer,
  p_start_time time,
  p_end_time time,
  p_instructor_id uuid,
  p_classroom_id uuid,
  p_substitute_instructor_id uuid,
  p_status text,
  p_cancel_reason text,
  p_notes text,
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
  v_conflicts jsonb;
  v_rule_id uuid;
  v_occurrence_id uuid;
  v_existing_rule record;
  v_metadata jsonb := '{}'::jsonb;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'Schedule mutation is server-only.';
  end if;
  if p_kind not in ('recurring', 'single') or p_scope not in ('single', 'future', 'all') then
    raise exception using errcode = '22023', message = 'Invalid schedule mutation kind or scope.';
  end if;
  if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
    raise exception using errcode = '22023', message = 'End time must follow start time.';
  end if;
  if not exists (
    select 1 from core.classes c
    where c.id = p_class_id and c.academy_id = p_academy_id and c.active
  ) then
    raise exception using errcode = '22023', message = 'An active academy class is required.';
  end if;
  if p_instructor_id is not null and not exists (
    select 1 from core.staff_members staff
    where staff.id = p_instructor_id and staff.academy_id = p_academy_id and staff.status = 'active'
  ) then
    raise exception using errcode = '22023', message = 'Instructor does not belong to the academy.';
  end if;
  if p_substitute_instructor_id is not null and not exists (
    select 1 from core.staff_members staff
    where staff.id = p_substitute_instructor_id and staff.academy_id = p_academy_id and staff.status = 'active'
  ) then
    raise exception using errcode = '22023', message = 'Substitute instructor does not belong to the academy.';
  end if;
  if p_classroom_id is not null and not exists (
    select 1 from lms.classrooms classroom
    where classroom.id = p_classroom_id and classroom.academy_id = p_academy_id and classroom.active
  ) then
    raise exception using errcode = '22023', message = 'Classroom does not belong to the academy.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_academy_id::text, 1127));

  if p_kind = 'single' and coalesce(p_status, 'scheduled') = 'cancelled' then
    v_conflicts := '[]'::jsonb;
  else
    v_conflicts := lms.schedule_conflicts_v1(
      p_academy_id, p_kind, p_class_id, p_rule_id, p_occurrence_id,
      p_date, p_day_of_week, p_start_date, p_end_date,
      greatest(coalesce(p_interval_weeks, 1), 1), p_start_time, p_end_time,
      p_instructor_id, p_classroom_id
    );
  end if;

  if jsonb_array_length(v_conflicts) > 0 then
    if exists (
      select 1
      from jsonb_array_elements(v_conflicts) as conflict(value)
      where conflict.value ->> 'kind' = 'class'
    ) then
      raise exception using errcode = 'P0001', message = 'A class cannot have overlapping schedules.';
    end if;
    if not coalesce(p_conflict_override_allowed, false)
       or nullif(btrim(coalesce(p_conflict_override_reason, '')), '') is null then
      raise exception using errcode = 'P0001', message = 'Schedule conflict must be resolved before saving.';
    end if;
    v_metadata := jsonb_build_object(
      'conflictOverrideReason', btrim(p_conflict_override_reason),
      'conflictOverrideBy', p_actor_person_id,
      'conflictOverrideAt', now()
    );
  end if;

  if p_kind = 'recurring' then
    if p_scope = 'single' or p_day_of_week not between 0 and 6 or p_start_date is null then
      raise exception using errcode = '22023', message = 'Recurring schedules require all or future scope and valid recurrence dates.';
    end if;

    if p_rule_id is null then
      insert into lms.class_schedule_rules (
        academy_id, class_id, day_of_week, start_time, end_time,
        start_date, end_date, interval_weeks, classroom_id,
        instructor_staff_id, active, metadata
      ) values (
        p_academy_id, p_class_id, p_day_of_week, p_start_time, p_end_time,
        p_start_date, p_end_date, greatest(coalesce(p_interval_weeks, 1), 1),
        p_classroom_id, p_instructor_id, true, v_metadata
      ) returning id into v_rule_id;
    else
      select * into v_existing_rule
      from lms.class_schedule_rules rule
      where rule.id = p_rule_id and rule.academy_id = p_academy_id
      for update;
      if v_existing_rule.id is null then
        raise exception using errcode = '22023', message = 'Schedule rule does not belong to the academy.';
      end if;

      if p_scope = 'all' then
        update lms.class_schedule_rules
        set class_id = p_class_id,
            day_of_week = p_day_of_week,
            start_time = p_start_time,
            end_time = p_end_time,
            start_date = p_start_date,
            end_date = p_end_date,
            interval_weeks = greatest(coalesce(p_interval_weeks, 1), 1),
            classroom_id = p_classroom_id,
            instructor_staff_id = p_instructor_id,
            active = true,
            metadata = coalesce(metadata, '{}'::jsonb) || v_metadata
        where id = p_rule_id and academy_id = p_academy_id
        returning id into v_rule_id;
      else
        if p_start_date <= v_existing_rule.start_date then
          raise exception using errcode = '22023', message = 'Future split date must follow the existing rule start date.';
        end if;
        update lms.class_schedule_rules
        set end_date = p_start_date - 1
        where id = p_rule_id and academy_id = p_academy_id;

        insert into lms.class_schedule_rules (
          academy_id, class_id, day_of_week, start_time, end_time,
          start_date, end_date, interval_weeks, classroom_id,
          instructor_staff_id, active, metadata
        ) values (
          p_academy_id, p_class_id, p_day_of_week, p_start_time, p_end_time,
          p_start_date, p_end_date, greatest(coalesce(p_interval_weeks, 1), 1),
          p_classroom_id, p_instructor_id, true, v_metadata
        ) returning id into v_rule_id;

        update lms.lesson_occurrences
        set rule_id = v_rule_id
        where academy_id = p_academy_id
          and rule_id = p_rule_id
          and occurrence_date >= p_start_date
          and not exists (
            select 1 from lms.attendance_records record
            where record.occurrence_id = lesson_occurrences.id
          );
      end if;
    end if;

    return jsonb_build_object('kind', 'recurring', 'id', v_rule_id, 'conflicts', v_conflicts);
  end if;

  if p_scope <> 'single' or p_date is null then
    raise exception using errcode = '22023', message = 'One-time schedules require single scope and a date.';
  end if;
  if coalesce(p_status, 'scheduled') not in ('scheduled', 'completed', 'cancelled', 'makeup', 'substitute') then
    raise exception using errcode = '22023', message = 'Unsupported lesson status.';
  end if;
  if p_status = 'cancelled' and nullif(btrim(coalesce(p_cancel_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'Cancelled lessons require a reason.';
  end if;
  if p_status = 'substitute' and p_substitute_instructor_id is null then
    raise exception using errcode = '22023', message = 'Substitute lessons require a substitute instructor.';
  end if;
  if p_rule_id is not null and not exists (
    select 1 from lms.class_schedule_rules rule
    where rule.id = p_rule_id and rule.academy_id = p_academy_id and rule.class_id = p_class_id
  ) then
    raise exception using errcode = '22023', message = 'Schedule rule does not belong to the class.';
  end if;

  if p_occurrence_id is not null then
    select occurrence.id into v_occurrence_id
    from lms.lesson_occurrences occurrence
    where occurrence.id = p_occurrence_id
      and occurrence.academy_id = p_academy_id
      and occurrence.class_id = p_class_id
    for update;
    if v_occurrence_id is null then
      raise exception using errcode = '22023', message = 'Lesson occurrence does not belong to the class.';
    end if;
  elsif p_rule_id is not null then
    select occurrence.id into v_occurrence_id
    from lms.lesson_occurrences occurrence
    where occurrence.academy_id = p_academy_id
      and occurrence.class_id = p_class_id
      and occurrence.rule_id = p_rule_id
      and occurrence.occurrence_date = p_date
    order by occurrence.created_at
    limit 1
    for update;
  end if;

  if v_occurrence_id is null then
    insert into lms.lesson_occurrences (
      academy_id, class_id, rule_id, occurrence_date, start_time, end_time,
      status, classroom_id, instructor_staff_id, substitute_staff_id,
      cancel_reason, override_scope, notes, metadata
    ) values (
      p_academy_id, p_class_id, p_rule_id, p_date, p_start_time, p_end_time,
      coalesce(p_status, 'scheduled'), p_classroom_id, p_instructor_id,
      p_substitute_instructor_id,
      case when p_status = 'cancelled' then nullif(btrim(coalesce(p_cancel_reason, '')), '') else null end,
      'single', nullif(btrim(coalesce(p_notes, '')), ''), v_metadata
    ) returning id into v_occurrence_id;
  else
    update lms.lesson_occurrences
    set occurrence_date = p_date,
        start_time = p_start_time,
        end_time = p_end_time,
        status = coalesce(p_status, 'scheduled'),
        classroom_id = p_classroom_id,
        instructor_staff_id = p_instructor_id,
        substitute_staff_id = p_substitute_instructor_id,
        cancel_reason = case when p_status = 'cancelled' then nullif(btrim(coalesce(p_cancel_reason, '')), '') else null end,
        override_scope = 'single',
        notes = nullif(btrim(coalesce(p_notes, '')), ''),
        metadata = coalesce(metadata, '{}'::jsonb) || v_metadata
    where id = v_occurrence_id and academy_id = p_academy_id;
  end if;

  return jsonb_build_object('kind', 'single', 'id', v_occurrence_id, 'conflicts', v_conflicts);
end;
$$;

create or replace function lms.change_class_members_v1(
  p_academy_id uuid,
  p_class_id uuid,
  p_effective_date date,
  p_changes jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_change jsonb;
  v_student_id uuid;
  v_action text;
  v_contract record;
  v_rule_type text;
  v_amount numeric(12, 2);
  v_primary boolean;
  v_added integer := 0;
  v_removed integer := 0;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'Class member mutation is server-only.';
  end if;
  if p_effective_date is null or p_effective_date > current_date or jsonb_typeof(p_changes) <> 'array'
     or jsonb_array_length(p_changes) < 1 or jsonb_array_length(p_changes) > 100 then
    raise exception using errcode = '22023', message = 'One to 100 class member changes are required.';
  end if;
  if jsonb_array_length(p_changes) <> (
    select count(distinct change.value ->> 'studentId')
    from jsonb_array_elements(p_changes) as change(value)
  ) then
    raise exception using errcode = '22023', message = 'Class member changes cannot contain duplicate students.';
  end if;
  if not exists (
    select 1 from core.classes c
    where c.id = p_class_id and c.academy_id = p_academy_id and c.active
  ) then
    raise exception using errcode = '22023', message = 'An active academy class is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_class_id::text, 2201));

  for v_change in
    select value
    from jsonb_array_elements(p_changes)
    order by value->>'studentId'
  loop
    begin
      v_student_id := (v_change->>'studentId')::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'Every class member change requires a valid student ID.';
    end;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_student_id::text, 2202));
    v_action := v_change->>'action';
    if v_action not in ('add', 'remove') then
      raise exception using errcode = '22023', message = 'Class member action must be add or remove.';
    end if;
    if not exists (
      select 1 from core.students student
      where student.id = v_student_id
        and student.academy_id = p_academy_id
        and student.status in ('active', 'on_leave')
    ) then
      raise exception using errcode = '22023', message = 'Student does not belong to the academy.';
    end if;

    if v_action = 'add' then
      if exists (
        select 1 from core.class_students enrollment
        where enrollment.class_id = p_class_id
          and enrollment.student_id = v_student_id
          and enrollment.status = 'active'
      ) then
        raise exception using errcode = '22023', message = 'Student is already active in the class.';
      end if;
      select not exists (
        select 1 from core.class_students enrollment
        join core.classes c on c.id = enrollment.class_id and c.academy_id = p_academy_id
        where enrollment.student_id = v_student_id
          and enrollment.status = 'active'
          and enrollment.primary_class
      ) into v_primary;

      insert into core.class_students (
        class_id, student_id, status, joined_at, ended_at, primary_class
      ) values (
        p_class_id, v_student_id, 'active', p_effective_date::timestamptz, null, v_primary
      )
      on conflict (class_id, student_id) do update
      set status = 'active', joined_at = excluded.joined_at,
          ended_at = null,
          primary_class = core.class_students.primary_class or excluded.primary_class;

      select contract.* into v_contract
      from lms.student_billing_contracts contract
      where contract.academy_id = p_academy_id
        and contract.student_id = v_student_id
        and contract.status = 'active'
        and contract.effective_from <= p_effective_date
        and (contract.effective_to is null or contract.effective_to >= p_effective_date)
      order by contract.effective_from desc
      limit 1
      for update;
      if v_contract.id is null then
        raise exception using errcode = '22023', message = 'Student requires an active billing contract.';
      end if;

      v_rule_type := coalesce(v_change#>>'{billingRule,ruleType}',
        case when v_contract.billing_mode = 'usage_based' then 'usage_based' else 'included' end);
      if v_rule_type not in ('included', 'extra_flat', 'discount', 'usage_based') then
        raise exception using errcode = '22023', message = 'Unsupported class billing rule.';
      end if;
      v_amount := greatest(coalesce((v_change#>>'{billingRule,amount}')::numeric,
        case when v_rule_type = 'usage_based' then coalesce(v_contract.hourly_rate, 0) else 0 end), 0);

      insert into lms.billing_class_rules (
        academy_id, contract_id, class_id, rule_type, amount, effective_from
      ) values (
        p_academy_id, v_contract.id, p_class_id, v_rule_type, v_amount, p_effective_date
      )
      on conflict (contract_id, class_id) do update
      set academy_id = excluded.academy_id,
          rule_type = excluded.rule_type,
          amount = excluded.amount,
          effective_from = excluded.effective_from,
          effective_to = null;
      v_added := v_added + 1;
    else
      select enrollment.primary_class into v_primary
      from core.class_students enrollment
      where enrollment.class_id = p_class_id
        and enrollment.student_id = v_student_id
        and enrollment.status = 'active'
      for update;

      if v_primary is null then
        raise exception using errcode = '22023', message = 'Student is not active in the class.';
      end if;

      update core.class_students
      set status = 'dropped', ended_at = p_effective_date::timestamptz, primary_class = false
      where class_id = p_class_id and student_id = v_student_id;

      delete from lms.billing_class_rules rule
      using lms.student_billing_contracts contract
      where rule.contract_id = contract.id
        and contract.academy_id = p_academy_id
        and contract.student_id = v_student_id
        and rule.class_id = p_class_id
        and rule.effective_from >= p_effective_date;
      update lms.billing_class_rules rule
      set effective_to = p_effective_date - 1
      from lms.student_billing_contracts contract
      where rule.contract_id = contract.id
        and contract.academy_id = p_academy_id
        and contract.student_id = v_student_id
        and rule.class_id = p_class_id
        and rule.effective_from < p_effective_date
        and (rule.effective_to is null or rule.effective_to >= p_effective_date);

      if coalesce(v_primary, false) then
        update core.class_students enrollment
        set primary_class = true
        where (enrollment.class_id, enrollment.student_id) = (
          select candidate.class_id, candidate.student_id
          from core.class_students candidate
          join core.classes c on c.id = candidate.class_id and c.academy_id = p_academy_id
          where candidate.student_id = v_student_id
            and candidate.status = 'active'
            and candidate.class_id <> p_class_id
          order by candidate.joined_at, candidate.class_id
          limit 1
        );
      end if;
      v_removed := v_removed + 1;
    end if;
  end loop;

  return jsonb_build_object('added', v_added, 'removed', v_removed);
end;
$$;

create or replace function lms.record_attendance_batch_v1(
  p_academy_id uuid,
  p_occurrence_id uuid,
  p_class_id uuid,
  p_rule_id uuid,
  p_date date,
  p_start_time time,
  p_end_time time,
  p_records jsonb,
  p_recorded_by uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_occurrence_id uuid := p_occurrence_id;
  v_record_count integer;
  v_enrollment_count integer;
  v_default_minutes integer;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'Attendance mutation is server-only.';
  end if;
  if p_date is null or p_start_time is null or p_end_time is null or p_end_time <= p_start_time
     or jsonb_typeof(p_records) <> 'array'
     or jsonb_array_length(p_records) < 1 or jsonb_array_length(p_records) > 300 then
    raise exception using errcode = '22023', message = 'One to 300 valid attendance records are required.';
  end if;
  if not exists (
    select 1 from core.classes c
    where c.id = p_class_id and c.academy_id = p_academy_id and c.active
  ) then
    raise exception using errcode = '22023', message = 'An active academy class is required.';
  end if;

  select count(*), count(distinct (record->>'student_id'))
  into v_record_count, v_enrollment_count
  from jsonb_array_elements(p_records) record;
  if v_record_count <> v_enrollment_count then
    raise exception using errcode = '22023', message = 'Attendance records cannot contain duplicate students.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_records) as source(
      student_id uuid,
      status text,
      attended_minutes integer,
      billable_minutes integer,
      notes text
    )
    where source.student_id is null
       or source.status not in ('present', 'late', 'absent', 'excused', 'makeup')
       or coalesce(source.attended_minutes, 0) < 0
       or coalesce(source.billable_minutes, 0) < 0
  ) then
    raise exception using errcode = '22023', message = 'Attendance rows contain invalid values.';
  end if;

  select count(*) into v_enrollment_count
  from core.class_students enrollment
  where enrollment.class_id = p_class_id
    and enrollment.status = 'active'
    and enrollment.student_id in (
      select (record->>'student_id')::uuid
      from jsonb_array_elements(p_records) record
    );
  if v_enrollment_count <> v_record_count then
    raise exception using errcode = '22023', message = 'Every attendance student must be active in the class.';
  end if;

  if p_rule_id is not null and not exists (
    select 1 from lms.class_schedule_rules rule
    where rule.id = p_rule_id and rule.academy_id = p_academy_id and rule.class_id = p_class_id
  ) then
    raise exception using errcode = '22023', message = 'Schedule rule does not belong to the class.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat_ws(':', p_class_id::text, p_date::text, p_start_time::text, coalesce(p_rule_id::text, 'none')),
    3301
  ));

  if exists (
    select 1
    from lms.lesson_occurrences occurrence
    where occurrence.academy_id = p_academy_id
      and occurrence.class_id = p_class_id
      and occurrence.status = 'cancelled'
      and (
        (p_occurrence_id is not null and occurrence.id = p_occurrence_id)
        or (
          p_occurrence_id is null
          and occurrence.occurrence_date = p_date
          and occurrence.start_time = p_start_time
          and (
            (p_rule_id is null and occurrence.rule_id is null)
            or occurrence.rule_id = p_rule_id
          )
        )
      )
  ) then
    raise exception using errcode = '22023', message = 'Attendance cannot be recorded for a cancelled lesson.';
  end if;

  if v_occurrence_id is not null then
    select occurrence.id into v_occurrence_id
    from lms.lesson_occurrences occurrence
    where occurrence.id = v_occurrence_id
      and occurrence.academy_id = p_academy_id
      and occurrence.class_id = p_class_id
      and occurrence.status <> 'cancelled'
      and occurrence.occurrence_date = p_date
      and occurrence.start_time = p_start_time
      and occurrence.end_time = p_end_time
    for update;
    if v_occurrence_id is null then
      raise exception using errcode = '22023', message = 'Lesson occurrence details do not match the selected class lesson.';
    end if;
  else
    select occurrence.id into v_occurrence_id
    from lms.lesson_occurrences occurrence
    where occurrence.academy_id = p_academy_id
      and occurrence.class_id = p_class_id
      and occurrence.status <> 'cancelled'
      and occurrence.occurrence_date = p_date
      and occurrence.start_time = p_start_time
      and (
        (p_rule_id is null and occurrence.rule_id is null)
        or occurrence.rule_id = p_rule_id
      )
    order by occurrence.created_at
    limit 1
    for update;
  end if;

  if v_occurrence_id is null then
    insert into lms.lesson_occurrences (
      academy_id, class_id, rule_id, occurrence_date, start_time, end_time, status
    ) values (
      p_academy_id, p_class_id, p_rule_id, p_date, p_start_time, p_end_time, 'scheduled'
    ) returning id into v_occurrence_id;
  end if;

  v_default_minutes := (extract(epoch from (p_end_time - p_start_time)) / 60)::integer;

  insert into lms.attendance_records (
    academy_id, occurrence_id, student_id, status,
    attended_minutes, billable_minutes, recorded_by, notes
  )
  select
    p_academy_id,
    v_occurrence_id,
    source.student_id,
    source.status,
    coalesce(source.attended_minutes,
      case when source.status in ('absent', 'excused') then 0 else v_default_minutes end),
    coalesce(source.billable_minutes,
      case when source.status in ('absent', 'excused') then 0 else v_default_minutes end),
    p_recorded_by,
    nullif(btrim(coalesce(source.notes, '')), '')
  from jsonb_to_recordset(p_records) as source(
    student_id uuid,
    status text,
    attended_minutes integer,
    billable_minutes integer,
    notes text
  )
  on conflict (occurrence_id, student_id) do update
  set status = excluded.status,
      attended_minutes = excluded.attended_minutes,
      billable_minutes = excluded.billable_minutes,
      recorded_by = excluded.recorded_by,
      notes = excluded.notes;

  return jsonb_build_object('occurrenceId', v_occurrence_id, 'recorded', v_record_count);
end;
$$;

create index if not exists lms_rules_active_instructor_conflict_idx
  on lms.class_schedule_rules (academy_id, instructor_staff_id, day_of_week, start_time, end_time)
  include (start_date, end_date, interval_weeks, class_id)
  where active and instructor_staff_id is not null;

create index if not exists lms_rules_active_classroom_conflict_idx
  on lms.class_schedule_rules (academy_id, classroom_id, day_of_week, start_time, end_time)
  include (start_date, end_date, interval_weeks, class_id)
  where active and classroom_id is not null;

create index if not exists lms_occurrences_instructor_conflict_idx
  on lms.lesson_occurrences (academy_id, occurrence_date, instructor_staff_id, start_time, end_time)
  where status <> 'cancelled' and instructor_staff_id is not null;

create index if not exists lms_occurrences_substitute_conflict_idx
  on lms.lesson_occurrences (academy_id, occurrence_date, substitute_staff_id, start_time, end_time)
  where status <> 'cancelled' and substitute_staff_id is not null;

create index if not exists lms_occurrences_classroom_conflict_idx
  on lms.lesson_occurrences (academy_id, occurrence_date, classroom_id, start_time, end_time)
  where status <> 'cancelled' and classroom_id is not null;

revoke all on function private.gcd_int_v1(integer, integer) from public, anon, authenticated;
revoke all on function private.schedule_rule_anchor_v1(date, integer) from public, anon, authenticated;
revoke all on function private.schedule_date_matches_rule_v1(date, integer, date, date, integer) from public, anon, authenticated;
revoke all on function private.schedule_rules_overlap_v1(integer, date, date, integer, integer, date, date, integer) from public, anon, authenticated;

grant execute on function private.gcd_int_v1(integer, integer) to service_role;
grant execute on function private.schedule_rule_anchor_v1(date, integer) to service_role;
grant execute on function private.schedule_date_matches_rule_v1(date, integer, date, date, integer) to service_role;
grant execute on function private.schedule_rules_overlap_v1(integer, date, date, integer, integer, date, date, integer) to service_role;

revoke all on function lms.schedule_conflicts_v1(uuid, text, uuid, uuid, uuid, date, integer, date, date, integer, time, time, uuid, uuid) from public, anon, authenticated;
revoke all on function lms.mutate_schedule_v1(uuid, text, text, uuid, uuid, uuid, date, integer, date, date, integer, time, time, uuid, uuid, uuid, text, text, text, text, boolean, uuid) from public, anon, authenticated;
revoke all on function lms.change_class_members_v1(uuid, uuid, date, jsonb) from public, anon, authenticated;
revoke all on function lms.record_attendance_batch_v1(uuid, uuid, uuid, uuid, date, time, time, jsonb, uuid) from public, anon, authenticated;

grant execute on function lms.schedule_conflicts_v1(uuid, text, uuid, uuid, uuid, date, integer, date, date, integer, time, time, uuid, uuid) to service_role;
grant execute on function lms.mutate_schedule_v1(uuid, text, text, uuid, uuid, uuid, date, integer, date, date, integer, time, time, uuid, uuid, uuid, text, text, text, text, boolean, uuid) to service_role;
grant execute on function lms.change_class_members_v1(uuid, uuid, date, jsonb) to service_role;
grant execute on function lms.record_attendance_batch_v1(uuid, uuid, uuid, uuid, date, time, time, jsonb, uuid) to service_role;
