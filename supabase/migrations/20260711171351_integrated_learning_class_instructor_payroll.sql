-- Integrated class directory, learning-path lifecycle, multi-instructor schedule,
-- payroll history, and canonical Grade App AI links.

-- ---------------------------------------------------------------------------
-- Subjects and target grades

create table lms.subjects (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references core.academies (id) on delete cascade,
  code        text,
  name        text not null,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (academy_id, name),
  unique (academy_id, code),
  check (btrim(name) <> ''),
  check (code is null or btrim(code) <> '')
);

alter table lms.courses
  add column if not exists subject_id uuid references lms.subjects (id) on delete set null;
alter table lms.class_profiles
  add column if not exists subject_id uuid references lms.subjects (id) on delete set null;

insert into lms.subjects (academy_id, code, name, sort_order)
select academy.id, seed.code, seed.name, seed.sort_order
from core.academies academy
cross join (values
  ('math', '수학', 10),
  ('korean', '국어', 20),
  ('english', '영어', 30),
  ('science', '과학', 40),
  ('social', '사회', 50),
  ('other', '기타', 90)
) as seed(code, name, sort_order)
on conflict (academy_id, code) do nothing;

create or replace function lms.seed_default_subjects_for_academy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into lms.subjects (academy_id, code, name, sort_order)
  values
    (new.id, 'math', '수학', 10),
    (new.id, 'korean', '국어', 20),
    (new.id, 'english', '영어', 30),
    (new.id, 'science', '과학', 40),
    (new.id, 'social', '사회', 50),
    (new.id, 'other', '기타', 90)
  on conflict (academy_id, code) do nothing;

  return new;
end;
$$;

revoke all on function lms.seed_default_subjects_for_academy()
from public, anon, authenticated;
grant execute on function lms.seed_default_subjects_for_academy()
to service_role;

drop trigger if exists seed_default_subjects_after_academy_insert on core.academies;
create trigger seed_default_subjects_after_academy_insert
after insert on core.academies
for each row execute function lms.seed_default_subjects_for_academy();

create table lms.class_target_grades (
  class_id    uuid not null,
  academy_id  uuid not null references core.academies (id) on delete cascade,
  grade_code  text not null,
  is_primary  boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (class_id, grade_code),
  constraint class_target_grades_class_same_academy
    foreign key (class_id, academy_id)
    references core.classes (id, academy_id) on delete cascade,
  check (btrim(grade_code) <> '')
);

create unique index class_target_grades_one_primary_idx
  on lms.class_target_grades (class_id)
  where is_primary;
create index class_target_grades_directory_idx
  on lms.class_target_grades (academy_id, grade_code, class_id);
create index class_profiles_subject_fk_idx on lms.class_profiles (subject_id) where subject_id is not null;
create index courses_subject_fk_idx on lms.courses (subject_id) where subject_id is not null;
create index subjects_directory_idx on lms.subjects (academy_id, active, sort_order, name, id);

insert into lms.class_target_grades (class_id, academy_id, grade_code, is_primary)
select c.id, c.academy_id, btrim(c.grade), true
from core.classes c
where nullif(btrim(c.grade), '') is not null
on conflict (class_id, grade_code) do nothing;

-- ---------------------------------------------------------------------------
-- Durable class assignments and effective lesson participants

create unique index class_schedule_rules_id_academy_class_key
  on lms.class_schedule_rules (id, academy_id, class_id);
create unique index lesson_occurrences_id_academy_class_key
  on lms.lesson_occurrences (id, academy_id, class_id);

create table lms.class_instructors (
  class_id             uuid not null,
  academy_id           uuid not null references core.academies (id) on delete cascade,
  instructor_staff_id  uuid not null,
  active               boolean not null default true,
  started_on           date not null default current_date,
  ended_on             date,
  source               text not null default 'manual'
                       check (source in ('manual', 'profile_backfill', 'rule_backfill')),
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (class_id, instructor_staff_id),
  constraint class_instructors_class_same_academy
    foreign key (class_id, academy_id)
    references core.classes (id, academy_id) on delete cascade,
  constraint class_instructors_staff_same_academy
    foreign key (instructor_staff_id, academy_id)
    references core.staff_members (id, academy_id) on delete cascade,
  check (ended_on is null or ended_on >= started_on)
);

create table lms.class_schedule_rule_instructors (
  rule_id              uuid not null,
  academy_id           uuid not null references core.academies (id) on delete cascade,
  class_id             uuid not null,
  instructor_staff_id  uuid not null,
  active               boolean not null default true,
  sort_order           integer not null default 0,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (rule_id, instructor_staff_id),
  constraint class_schedule_rule_instructors_rule_class_same_academy
    foreign key (rule_id, academy_id, class_id)
    references lms.class_schedule_rules (id, academy_id, class_id) on delete cascade,
  constraint class_schedule_rule_instructors_staff_same_academy
    foreign key (instructor_staff_id, academy_id)
    references core.staff_members (id, academy_id) on delete restrict
);

create table lms.lesson_occurrence_instructors (
  occurrence_id         uuid not null,
  academy_id            uuid not null references core.academies (id) on delete cascade,
  class_id              uuid not null,
  instructor_staff_id   uuid not null,
  participation_kind    text not null default 'regular'
                        check (participation_kind in ('regular', 'substitute', 'makeup', 'assistant')),
  payable_minutes       integer not null default 0 check (payable_minutes >= 0),
  replaces_staff_id     uuid references core.staff_members (id) on delete set null,
  instructor_name       text,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  primary key (occurrence_id, instructor_staff_id),
  constraint lesson_occurrence_instructors_occurrence_class_same_academy
    foreign key (occurrence_id, academy_id, class_id)
    references lms.lesson_occurrences (id, academy_id, class_id) on delete cascade,
  constraint lesson_occurrence_instructors_staff_same_academy
    foreign key (instructor_staff_id, academy_id)
    references core.staff_members (id, academy_id) on delete restrict,
  constraint lesson_occurrence_instructors_replaces_same_academy
    foreign key (replaces_staff_id, academy_id)
    references core.staff_members (id, academy_id)
);

create index class_instructors_staff_idx
  on lms.class_instructors (academy_id, instructor_staff_id, active, class_id);
create index class_schedule_rule_instructors_staff_idx
  on lms.class_schedule_rule_instructors (academy_id, instructor_staff_id, active, rule_id);
create index class_schedule_rule_instructors_class_idx
  on lms.class_schedule_rule_instructors (academy_id, class_id, rule_id);
create index lesson_occurrence_instructors_staff_idx
  on lms.lesson_occurrence_instructors (academy_id, instructor_staff_id, occurrence_id);
create index lesson_occurrence_instructors_class_idx
  on lms.lesson_occurrence_instructors (academy_id, class_id, occurrence_id);
create index lesson_occurrence_instructors_replaces_idx
  on lms.lesson_occurrence_instructors (replaces_staff_id)
  where replaces_staff_id is not null;

insert into lms.class_instructors (
  class_id, academy_id, instructor_staff_id, started_on, source
)
select profile.class_id, profile.academy_id, profile.default_instructor_staff_id,
       coalesce(class_row.created_at::date, current_date), 'profile_backfill'
from lms.class_profiles profile
join core.classes class_row on class_row.id = profile.class_id
where profile.default_instructor_staff_id is not null
on conflict (class_id, instructor_staff_id) do nothing;

insert into lms.class_instructors (
  class_id, academy_id, instructor_staff_id, started_on, source
)
select distinct rule.class_id, rule.academy_id, rule.instructor_staff_id,
       rule.start_date, 'rule_backfill'
from lms.class_schedule_rules rule
where rule.instructor_staff_id is not null
on conflict (class_id, instructor_staff_id) do update
set active = true,
    started_on = least(lms.class_instructors.started_on, excluded.started_on),
    updated_at = now();

insert into lms.class_schedule_rule_instructors (
  rule_id, academy_id, class_id, instructor_staff_id
)
select rule.id, rule.academy_id, rule.class_id,
       coalesce(rule.instructor_staff_id, profile.default_instructor_staff_id)
from lms.class_schedule_rules rule
left join lms.class_profiles profile on profile.class_id = rule.class_id
where coalesce(rule.instructor_staff_id, profile.default_instructor_staff_id) is not null
on conflict (rule_id, instructor_staff_id) do nothing;

-- A legacy substitute replaced the legacy singular effective instructor.
insert into lms.lesson_occurrence_instructors (
  occurrence_id, academy_id, class_id, instructor_staff_id,
  participation_kind, payable_minutes, replaces_staff_id
)
select occurrence.id, occurrence.academy_id, occurrence.class_id,
       occurrence.substitute_staff_id, 'substitute',
       greatest(0, occurrence.duration_minutes),
       coalesce(occurrence.instructor_staff_id, rule.instructor_staff_id, profile.default_instructor_staff_id)
from lms.lesson_occurrences occurrence
left join lms.class_schedule_rules rule on rule.id = occurrence.rule_id
left join lms.class_profiles profile on profile.class_id = occurrence.class_id
where occurrence.substitute_staff_id is not null
on conflict (occurrence_id, instructor_staff_id) do nothing;

-- A materialized occurrence without an explicit substitute inherits the
-- occurrence, rule, or profile instructor in that order.
insert into lms.lesson_occurrence_instructors (
  occurrence_id, academy_id, class_id, instructor_staff_id,
  participation_kind, payable_minutes
)
select occurrence.id, occurrence.academy_id, occurrence.class_id,
       coalesce(occurrence.instructor_staff_id, rule.instructor_staff_id, profile.default_instructor_staff_id),
       case when occurrence.status = 'makeup' then 'makeup' else 'regular' end,
       case when occurrence.status = 'cancelled' then 0 else greatest(0, occurrence.duration_minutes) end
from lms.lesson_occurrences occurrence
left join lms.class_schedule_rules rule on rule.id = occurrence.rule_id
left join lms.class_profiles profile on profile.class_id = occurrence.class_id
where occurrence.substitute_staff_id is null
  and coalesce(occurrence.instructor_staff_id, rule.instructor_staff_id, profile.default_instructor_staff_id) is not null
on conflict (occurrence_id, instructor_staff_id) do nothing;

-- ---------------------------------------------------------------------------
-- Effective-dated pay rates and structured payment adjustments

create table lms.instructor_pay_rates (
  id             uuid primary key default gen_random_uuid(),
  academy_id     uuid not null references core.academies (id) on delete cascade,
  instructor_id  uuid not null,
  effective_from date not null,
  hourly_rate    numeric(12, 2) not null check (hourly_rate >= 0),
  active         boolean not null default true,
  created_by     uuid references core.people (id) on delete set null,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (instructor_id, effective_from),
  constraint instructor_pay_rates_staff_same_academy
    foreign key (instructor_id, academy_id)
    references core.staff_members (id, academy_id) on delete cascade
);

create index instructor_pay_rates_lookup_idx
  on lms.instructor_pay_rates (academy_id, instructor_id, effective_from desc)
  where active;
create index instructor_pay_rates_created_by_idx
  on lms.instructor_pay_rates (created_by)
  where created_by is not null;

insert into lms.instructor_pay_rates (academy_id, instructor_id, effective_from, hourly_rate)
select staff.academy_id, staff.id,
       coalesce(staff.hire_date, staff.created_at::date, current_date),
       staff.hourly_rate
from core.staff_members staff
where staff.hourly_rate is not null and staff.hourly_rate >= 0
on conflict (instructor_id, effective_from) do nothing;

alter table lms.instructor_payments
  add column if not exists base_amount numeric(12, 2) not null default 0,
  add column if not exists additional_amount numeric(12, 2) not null default 0,
  add column if not exists deduction_amount numeric(12, 2) not null default 0;

update lms.instructor_payments
set base_amount = gross_amount,
    additional_amount = 0,
    deduction_amount = 0
where base_amount = 0 and gross_amount <> 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'lms.instructor_payments'::regclass
      and conname = 'instructor_payments_amount_breakdown_check'
  ) then
    alter table lms.instructor_payments
      add constraint instructor_payments_amount_breakdown_check
      check (base_amount >= 0 and additional_amount >= 0 and deduction_amount >= 0);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Learning path lifecycle

alter table learning.analysis_plans
  add column if not exists path_role text not null default 'supplemental',
  add column if not exists path_purpose text not null default 'other',
  add column if not exists completed_at timestamptz;

update learning.analysis_plans
set path_role = case
      when plan_type = 'study_track' and coalesce(metadata->>'track_kind', '') = 'current' then 'primary'
      else 'supplemental'
    end,
    path_purpose = case
      when plan_type = 'exam' then 'exam'
      when metadata->>'track_kind' = 'advance' then 'advance'
      when metadata->>'track_kind' = 'maintenance' then 'review'
      when metadata->>'track_kind' = 'current' then 'current'
      else 'other'
    end;

-- If legacy data contains several active current paths, retain only the newest
-- as primary and leave the others active as supplemental paths.
with ranked as (
  select id,
         row_number() over (partition by class_id order by updated_at desc, id desc) as position
  from learning.analysis_plans
  where status = 'active' and path_role = 'primary'
)
update learning.analysis_plans plan
set path_role = 'supplemental'
from ranked
where plan.id = ranked.id and ranked.position > 1;

alter table learning.analysis_plans drop constraint if exists analysis_plans_status_check;
alter table learning.analysis_plans
  add constraint analysis_plans_status_check
  check (status in ('draft', 'active', 'completed', 'archived')),
  add constraint analysis_plans_path_role_check
  check (path_role in ('primary', 'supplemental')),
  add constraint analysis_plans_path_purpose_check
  check (path_purpose in ('current', 'advance', 'review', 'exam', 'other'));

create unique index analysis_plans_one_active_primary_idx
  on learning.analysis_plans (class_id)
  where status = 'active' and path_role = 'primary';
create index analysis_plans_class_lifecycle_idx
  on learning.analysis_plans (academy_id, class_id, status, path_role, updated_at desc);

create or replace function learning.start_analysis_path_v2(
  p_academy_id uuid,
  p_plan_id uuid
)
returns learning.analysis_plans
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_target learning.analysis_plans;
  v_today date := (pg_catalog.now() at time zone 'Asia/Seoul')::date;
begin
  select * into v_target
  from learning.analysis_plans
  where id = p_plan_id and academy_id = p_academy_id
  for update;

  if v_target.id is null then
    raise exception using errcode = 'P0002', message = 'Learning path was not found.';
  end if;
  if v_target.path_role <> 'primary' then
    raise exception using errcode = '22023', message = 'Only a primary learning path can replace the current primary path.';
  end if;
  if v_target.status <> 'draft' then
    raise exception using errcode = '22023', message = 'Only a prepared draft learning path can be started.';
  end if;
  if current_user <> 'service_role'
     and p_academy_id not in (
       select private.current_academy_ids(array['owner', 'admin', 'staff'])
     )
     and v_target.class_id not in (select private.current_assigned_class_ids()) then
    raise exception using errcode = '42501', message = 'Caller cannot manage this learning path.';
  end if;

  perform 1
  from learning.analysis_plans
  where class_id = v_target.class_id and path_role = 'primary'
  for update;

  update learning.analysis_plans
  set status = 'completed', completed_at = now(), ends_on = v_today, updated_at = now()
  where class_id = v_target.class_id
    and path_role = 'primary'
    and status = 'active'
    and id <> v_target.id;

  update learning.analysis_plans
  set status = 'active', starts_on = v_today, completed_at = null, updated_at = now()
  where id = v_target.id
  returning * into v_target;

  return v_target;
end;
$$;

revoke all on function learning.start_analysis_path_v2(uuid, uuid) from public, anon;
grant execute on function learning.start_analysis_path_v2(uuid, uuid) to authenticated, service_role;

create or replace function learning.create_analysis_path_v2(
  p_actor_auth_user_id uuid,
  p_academy_id uuid,
  p_input jsonb
)
returns table (
  plan_id uuid,
  scope_count integer,
  material_count integer,
  path_role text,
  path_purpose text,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class_id uuid;
  v_plan_id uuid;
  v_scope_count integer;
  v_material_count integer;
  v_path_role text;
  v_path_purpose text;
  v_status text;
  v_track_kind text;
  v_class_context jsonb;
begin
  if jsonb_typeof(coalesce(p_input, 'null'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'input must be a JSON object';
  end if;

  begin
    v_class_id := nullif(p_input ->> 'class_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'class_id is invalid';
  end;
  if v_class_id is null then
    raise exception using errcode = '22023', message = 'class_id is required';
  end if;

  v_track_kind := nullif(p_input ->> 'track_kind', '');
  v_path_role := coalesce(
    nullif(p_input ->> 'path_role', ''),
    case when v_track_kind = 'current' then 'primary' else 'supplemental' end
  );
  v_path_purpose := coalesce(
    nullif(p_input ->> 'path_purpose', ''),
    case
      when p_input ->> 'plan_type' = 'exam' then 'exam'
      when v_track_kind = 'current' then 'current'
      when v_track_kind = 'advance' then 'advance'
      when v_track_kind = 'maintenance' then 'review'
      else 'other'
    end
  );
  if v_path_role not in ('primary', 'supplemental') then
    raise exception using errcode = '22023', message = 'path_role must be primary or supplemental';
  end if;
  if v_path_purpose not in ('current', 'advance', 'review', 'exam', 'other') then
    raise exception using errcode = '22023', message = 'path_purpose is invalid';
  end if;
  if v_path_role = 'primary' and v_path_purpose = 'exam' then
    raise exception using errcode = '22023', message = 'an exam path cannot be the primary path';
  end if;

  -- Serialize primary-path creation for one class. The legacy creator performs
  -- the full actor, class, scope, material, and student validation below.
  perform 1
  from core.classes class_row
  where class_row.id = v_class_id and class_row.academy_id = p_academy_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'class is unavailable to this academy';
  end if;

  select jsonb_build_object(
    'subject_id', profile.subject_id,
    'course_id', profile.course_id,
    'target_grades', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'grade_code', target.grade_code,
          'is_primary', target.is_primary,
          'sort_order', target.sort_order
        )
        order by target.is_primary desc, target.sort_order, target.grade_code
      )
      from lms.class_target_grades target
      where target.class_id = class_row.id
        and target.academy_id = class_row.academy_id
    ), '[]'::jsonb)
  )
  into v_class_context
  from core.classes class_row
  left join lms.class_profiles profile
    on profile.class_id = class_row.id
   and profile.academy_id = class_row.academy_id
  where class_row.id = v_class_id
    and class_row.academy_id = p_academy_id;

  select created.plan_id, created.scope_count, created.material_count
  into v_plan_id, v_scope_count, v_material_count
  from learning.create_analysis_plan_v1(
    p_actor_auth_user_id,
    p_academy_id,
    p_input
  ) created;

  if v_path_role = 'primary' and exists (
    select 1
    from learning.analysis_plans existing
    where existing.class_id = v_class_id
      and existing.id <> v_plan_id
      and existing.path_role = 'primary'
      and existing.status = 'active'
  ) then
    v_status := 'draft';
  else
    v_status := 'active';
  end if;

  update learning.analysis_plans plan
  set path_role = v_path_role,
      path_purpose = v_path_purpose,
      status = v_status,
      starts_on = coalesce(plan.starts_on, current_date),
      completed_at = null,
      updated_at = now(),
      metadata = coalesce(plan.metadata, '{}'::jsonb) || jsonb_build_object(
        'created_via', 'learning.create_analysis_path_v2',
        'class_context', v_class_context
      )
  where plan.id = v_plan_id;

  update learning.analysis_plan_student_overrides plan_override
  set included = coalesce(requested.included, true),
      updated_at = now()
  from jsonb_to_recordset(
    coalesce(p_input -> 'student_overrides', '[]'::jsonb)
  ) requested(student_id uuid, included boolean)
  where plan_override.plan_id = v_plan_id
    and plan_override.student_id = requested.student_id;

  return query
  select v_plan_id, v_scope_count, v_material_count, v_path_role, v_path_purpose, v_status;
end;
$$;

revoke all on function learning.create_analysis_path_v2(uuid,uuid,jsonb)
from public, anon, authenticated;
grant execute on function learning.create_analysis_path_v2(uuid,uuid,jsonb)
to service_role;

-- Server-side class directory with keyset pagination. Facets are calculated
-- from the caller's accessible class set, while rows honor the active filters.
create or replace function lms.class_directory_v1(
  p_academy_id uuid,
  p_q text default null,
  p_grade text default null,
  p_subject text default null,
  p_instructor uuid default null,
  p_status text default 'active',
  p_cursor_name text default null,
  p_cursor_id uuid default null,
  p_limit integer default 60,
  p_class_ids uuid[] default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 60), 1), 100);
  v_result jsonb;
begin
  if p_academy_id is null then
    raise exception using errcode = '22023', message = 'academy_id is required.';
  end if;
  if coalesce(p_status, 'active') not in ('active', 'inactive', 'archived', 'all') then
    raise exception using errcode = '22023', message = 'Invalid class status filter.';
  end if;
  if current_user <> 'service_role'
     and p_academy_id not in (
       select private.current_academy_ids(array['owner','admin','staff','teacher','instructor'])
     ) then
    raise exception using errcode = '42501', message = 'Caller cannot read this class directory.';
  end if;

  with accessible as materialized (
    select
      class_row.id,
      class_row.name,
      class_row.grade,
      class_row.active,
      coalesce(profile.status, case when class_row.active then 'active' else 'inactive' end) as status,
      profile.color,
      profile.capacity,
      profile.default_instructor_staff_id,
      profile.default_classroom_id,
      profile.course_id,
      profile.subject_id,
      profile.notes,
      subject.name as subject_name,
      course.title as course_title,
      classroom.name as classroom_name,
      coalesce(primary_grade.grade_code, class_row.grade) as primary_grade,
      coalesce(grades.target_grades, '[]'::jsonb) as target_grades,
      coalesce(instructors.instructors, '[]'::jsonb) as instructors,
      coalesce(instructors.instructor_ids, '[]'::jsonb) as instructor_ids,
      coalesce(enrollment.student_count, 0) as student_count,
      coalesce(default_person.display_name, default_person.full_name) as default_instructor_name
    from core.classes class_row
    left join lms.class_profiles profile on profile.class_id = class_row.id
    left join lms.subjects subject on subject.id = profile.subject_id
    left join lms.courses course on course.id = profile.course_id
    left join lms.classrooms classroom on classroom.id = profile.default_classroom_id
    left join core.staff_members default_staff on default_staff.id = profile.default_instructor_staff_id
    left join core.people default_person on default_person.id = default_staff.person_id
    left join lateral (
      select target.grade_code
      from lms.class_target_grades target
      where target.class_id = class_row.id
      order by target.is_primary desc, target.sort_order, target.grade_code
      limit 1
    ) primary_grade on true
    left join lateral (
      select jsonb_agg(target.grade_code order by target.is_primary desc, target.sort_order, target.grade_code) as target_grades
      from lms.class_target_grades target
      where target.class_id = class_row.id
    ) grades on true
    left join lateral (
      select
        jsonb_agg(
          jsonb_build_object('id', assignment.instructor_staff_id, 'name', coalesce(person.display_name, person.full_name, '이름 미확인'))
          order by coalesce(person.display_name, person.full_name, ''), assignment.instructor_staff_id
        ) as instructors,
        jsonb_agg(assignment.instructor_staff_id order by assignment.instructor_staff_id) as instructor_ids
      from lms.class_instructors assignment
      join core.staff_members staff on staff.id = assignment.instructor_staff_id
      join core.people person on person.id = staff.person_id
      where assignment.class_id = class_row.id
        and assignment.active
        and assignment.started_on <= current_date
        and (assignment.ended_on is null or assignment.ended_on >= current_date)
    ) instructors on true
    left join lateral (
      select count(*)::integer as student_count
      from core.class_students enrollment
      where enrollment.class_id = class_row.id and enrollment.status = 'active'
    ) enrollment on true
    where class_row.academy_id = p_academy_id
      and (p_class_ids is null or class_row.id = any(p_class_ids))
      and (
        current_user = 'service_role'
        or p_academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
        or class_row.id in (select private.current_assigned_class_ids())
      )
  ),
  filtered as materialized (
    select row.*
    from accessible row
    where (p_status is null or p_status = 'all' or row.status = p_status)
      and (nullif(btrim(p_grade), '') is null or row.target_grades ? p_grade or row.grade = p_grade)
      and (
        nullif(btrim(p_subject), '') is null
        or row.subject_id::text = p_subject
        or lower(coalesce(row.subject_name, '')) = lower(p_subject)
      )
      and (p_instructor is null or row.instructor_ids ? p_instructor::text or row.default_instructor_staff_id = p_instructor)
      and (
        nullif(btrim(p_q), '') is null
        or lower(row.name) like '%' || lower(btrim(p_q)) || '%'
        or lower(coalesce(row.subject_name, '')) like '%' || lower(btrim(p_q)) || '%'
        or lower(coalesce(row.course_title, '')) like '%' || lower(btrim(p_q)) || '%'
        or lower(coalesce(row.default_instructor_name, '')) like '%' || lower(btrim(p_q)) || '%'
        or exists (
          select 1
          from jsonb_array_elements(row.instructors) instructor
          where lower(coalesce(instructor->>'name', '')) like '%' || lower(btrim(p_q)) || '%'
        )
      )
  ),
  page_plus_one as materialized (
    select row.*
    from filtered row
    where p_cursor_name is null
       or (lower(row.name), row.id) > (lower(p_cursor_name), p_cursor_id)
    order by lower(row.name), row.id
    limit v_limit + 1
  ),
  page as materialized (
    select * from page_plus_one
    order by lower(name), id
    limit v_limit
  ),
  last_page as (
    select name, id from page order by lower(name) desc, id desc limit 1
  ),
  grade_facets as (
    select jsonb_agg(jsonb_build_object('value', grade_code, 'label', grade_code, 'count', count) order by grade_code) as value
    from (
      select grade_code, count(distinct class_id)::integer as count
      from (
        select target.class_id, target.grade_code
        from lms.class_target_grades target
        join accessible row on row.id = target.class_id
        union all
        select row.id, row.grade from accessible row
        where row.grade is not null
          and not exists (select 1 from lms.class_target_grades target where target.class_id = row.id)
      ) grades
      group by grade_code
    ) grouped
  ),
  subject_facets as (
    select jsonb_agg(jsonb_build_object('value', subject_id, 'label', subject_name, 'count', count) order by subject_name) as value
    from (
      select subject_id, subject_name, count(*)::integer as count
      from accessible
      where subject_id is not null
      group by subject_id, subject_name
    ) grouped
  ),
  instructor_facets as (
    select jsonb_agg(jsonb_build_object('value', instructor_id, 'label', instructor_name, 'count', count) order by instructor_name) as value
    from (
      select instructor->>'id' as instructor_id, instructor->>'name' as instructor_name, count(distinct row.id)::integer as count
      from accessible row
      cross join lateral jsonb_array_elements(row.instructors) instructor
      group by instructor->>'id', instructor->>'name'
    ) grouped
  ),
  status_facets as (
    select jsonb_agg(jsonb_build_object('value', status, 'label', status, 'count', count) order by status) as value
    from (select status, count(*)::integer as count from accessible group by status) grouped
  )
  select jsonb_build_object(
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', row.id,
        'name', row.name,
        'grade', row.grade,
        'subjectId', row.subject_id,
        'subjectName', row.subject_name,
        'targetGrades', row.target_grades,
        'primaryTargetGrade', row.primary_grade,
        'active', row.active,
        'status', row.status,
        'color', row.color,
        'capacity', row.capacity,
        'defaultInstructorId', row.default_instructor_staff_id,
        'instructorIds', row.instructor_ids,
        'instructors', row.instructors,
        'defaultClassroomId', row.default_classroom_id,
        'courseTitle', row.course_title,
        'instructorName', row.default_instructor_name,
        'classroomName', row.classroom_name,
        'studentCount', row.student_count,
        'weakTypeCount', 0,
        'avgTypeScore', null,
        'lastLearningAt', null,
        'notes', row.notes
      ) order by lower(row.name), row.id) from page row
    ), '[]'::jsonb),
    'facets', jsonb_build_object(
      'grades', coalesce((select value from grade_facets), '[]'::jsonb),
      'subjects', coalesce((select value from subject_facets), '[]'::jsonb),
      'instructors', coalesce((select value from instructor_facets), '[]'::jsonb),
      'statuses', coalesce((select value from status_facets), '[]'::jsonb)
    ),
    'nextCursor', case when (select count(*) from page_plus_one) > v_limit then (
      select jsonb_build_object('name', name, 'id', id) from last_page
    ) else null end,
    'hasMore', (select count(*) from page_plus_one) > v_limit,
    'totalCount', (select count(*) from filtered)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function lms.class_directory_v1(uuid,text,text,text,uuid,text,text,uuid,integer,uuid[]) from public, anon;
grant execute on function lms.class_directory_v1(uuid,text,text,text,uuid,text,text,uuid,integer,uuid[]) to authenticated, service_role;

-- Conflict checks include all effective participants. Actual occurrence
-- snapshots replace rule participants; legacy singular columns are fallback.
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
    coalesce(v_instructor_id, profile.default_instructor_staff_id),
    coalesce(v_classroom_id, profile.default_classroom_id)
  into v_instructor_id, v_classroom_id
  from lms.class_profiles profile
  where profile.academy_id = p_academy_id and profile.class_id = p_class_id;

  for v_row in
    with rule_candidates as materialized (
      select
        'rule'::text as source,
        rule.id,
        rule.class_id,
        class_row.name as class_name,
        null::date as occurrence_date,
        rule.day_of_week,
        rule.start_time,
        rule.end_time,
        coalesce(
          participants.instructor_ids,
          case
            when coalesce(rule.instructor_staff_id, profile.default_instructor_staff_id) is null
              then array[]::uuid[]
            else array[coalesce(rule.instructor_staff_id, profile.default_instructor_staff_id)]
          end
        ) as instructor_ids,
        coalesce(
          participants.instructor_names,
          coalesce(legacy_person.display_name, legacy_person.full_name)
        ) as instructor_name,
        coalesce(rule.classroom_id, profile.default_classroom_id) as classroom_id,
        classroom.name as classroom_name
      from lms.class_schedule_rules rule
      join core.classes class_row
        on class_row.id = rule.class_id and class_row.academy_id = p_academy_id
      left join lms.class_profiles profile on profile.class_id = rule.class_id
      left join lateral (
        select
          array_agg(
            assignment.instructor_staff_id
            order by assignment.sort_order, assignment.instructor_staff_id
          ) as instructor_ids,
          string_agg(
            coalesce(person.display_name, person.full_name, '이름 미확인'),
            ' · ' order by assignment.sort_order, assignment.instructor_staff_id
          ) as instructor_names
        from lms.class_schedule_rule_instructors assignment
        join core.staff_members staff on staff.id = assignment.instructor_staff_id
        left join core.people person on person.id = staff.person_id
        where assignment.rule_id = rule.id and assignment.active
      ) participants on true
      left join core.staff_members legacy_staff
        on legacy_staff.id = coalesce(rule.instructor_staff_id, profile.default_instructor_staff_id)
      left join core.people legacy_person on legacy_person.id = legacy_staff.person_id
      left join lms.classrooms classroom
        on classroom.id = coalesce(rule.classroom_id, profile.default_classroom_id)
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
    ),
    occurrence_candidates as materialized (
      select
        'occurrence'::text as source,
        occurrence.id,
        occurrence.class_id,
        class_row.name as class_name,
        occurrence.occurrence_date,
        null::integer as day_of_week,
        occurrence.start_time,
        occurrence.end_time,
        case
          when actual_participants.instructor_ids is not null
            then actual_participants.instructor_ids
          when occurrence.substitute_staff_id is not null
            then array[occurrence.substitute_staff_id]
          when occurrence.rule_id is not null
               and occurrence.override_scope is null
               and rule_participants.instructor_ids is not null
            then rule_participants.instructor_ids
          when occurrence.instructor_staff_id is not null
            then array[occurrence.instructor_staff_id]
          when rule_participants.instructor_ids is not null
            then rule_participants.instructor_ids
          when source_rule.instructor_staff_id is not null
            then array[source_rule.instructor_staff_id]
          when profile.default_instructor_staff_id is not null
            then array[profile.default_instructor_staff_id]
          else array[]::uuid[]
        end as instructor_ids,
        case
          when actual_participants.instructor_ids is not null
            then actual_participants.instructor_names
          when occurrence.rule_id is not null
               and occurrence.override_scope is null
               and rule_participants.instructor_ids is not null
            then rule_participants.instructor_names
          when occurrence.instructor_staff_id is null
               and occurrence.substitute_staff_id is null
               and rule_participants.instructor_ids is not null
            then rule_participants.instructor_names
          else coalesce(legacy_person.display_name, legacy_person.full_name)
        end as instructor_name,
        coalesce(
          occurrence.classroom_id,
          source_rule.classroom_id,
          profile.default_classroom_id
        ) as classroom_id,
        classroom.name as classroom_name
      from lms.lesson_occurrences occurrence
      join core.classes class_row
        on class_row.id = occurrence.class_id and class_row.academy_id = p_academy_id
      left join lms.class_profiles profile on profile.class_id = occurrence.class_id
      left join lms.class_schedule_rules source_rule on source_rule.id = occurrence.rule_id
      left join lateral (
        select
          array_agg(
            participant.instructor_staff_id order by participant.instructor_staff_id
          ) as instructor_ids,
          string_agg(
            coalesce(person.display_name, person.full_name, participant.instructor_name, '이름 미확인'),
            ' · ' order by participant.instructor_staff_id
          ) as instructor_names
        from lms.lesson_occurrence_instructors participant
        left join core.staff_members staff on staff.id = participant.instructor_staff_id
        left join core.people person on person.id = staff.person_id
        where participant.occurrence_id = occurrence.id
      ) actual_participants on true
      left join lateral (
        select
          array_agg(
            assignment.instructor_staff_id
            order by assignment.sort_order, assignment.instructor_staff_id
          ) as instructor_ids,
          string_agg(
            coalesce(person.display_name, person.full_name, '이름 미확인'),
            ' · ' order by assignment.sort_order, assignment.instructor_staff_id
          ) as instructor_names
        from lms.class_schedule_rule_instructors assignment
        join core.staff_members staff on staff.id = assignment.instructor_staff_id
        left join core.people person on person.id = staff.person_id
        where assignment.rule_id = occurrence.rule_id and assignment.active
      ) rule_participants on true
      left join core.staff_members legacy_staff on legacy_staff.id = coalesce(
        occurrence.substitute_staff_id,
        occurrence.instructor_staff_id,
        source_rule.instructor_staff_id,
        profile.default_instructor_staff_id
      )
      left join core.people legacy_person on legacy_person.id = legacy_staff.person_id
      left join lms.classrooms classroom on classroom.id = coalesce(
        occurrence.classroom_id,
        source_rule.classroom_id,
        profile.default_classroom_id
      )
      where occurrence.academy_id = p_academy_id
        and occurrence.status <> 'cancelled'
        and (p_occurrence_id is null or occurrence.id <> p_occurrence_id)
        and (
          p_kind <> 'recurring'
          or p_rule_id is null
          or occurrence.rule_id is distinct from p_rule_id
        )
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
    )
    select * from rule_candidates
    union all
    select * from occurrence_candidates
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
    if v_instructor_id is not null
       and v_instructor_id = any(coalesce(v_row.instructor_ids, array[]::uuid[])) then
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

revoke all on function lms.schedule_conflicts_v1(uuid,text,uuid,uuid,uuid,date,integer,date,date,integer,time,time,uuid,uuid)
from public, anon, authenticated;
grant execute on function lms.schedule_conflicts_v1(uuid,text,uuid,uuid,uuid,date,integer,date,date,integer,time,time,uuid,uuid)
to service_role;

-- ---------------------------------------------------------------------------
-- Canonical Grade App AI links from trusted sessions and attempts

update ai.conversations conversation
set core_student_id = coalesce(conversation.core_student_id, conversation.student_id)
where conversation.core_student_id is null;

update ai.conversations conversation
set session_id = session.id,
    assignment_id = session.assignment_id
from learning.sessions session
where conversation.session_id is null
  and session.id = core.uuid_or_null(conversation.metadata->>'sessionId')
  and session.academy_id = conversation.academy_id
  and session.core_student_id = coalesce(conversation.core_student_id, conversation.student_id);

update ai.conversations conversation
set assignment_id = session.assignment_id
from learning.sessions session
where conversation.session_id = session.id
  and conversation.assignment_id is null
  and session.academy_id = conversation.academy_id
  and session.core_student_id = coalesce(conversation.core_student_id, conversation.student_id);

update ai.conversations conversation
set problem_id = attempt.problem_id
from learning.attempts attempt
where conversation.problem_id is null
  and conversation.session_id = attempt.session_id
  and attempt.core_student_id = coalesce(conversation.core_student_id, conversation.student_id)
  and attempt.problem_id = nullif(conversation.metadata->>'problemId', '');

-- ---------------------------------------------------------------------------
-- Access helpers, RLS, explicit grants, and timestamps

create or replace function private.current_assigned_class_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with actor as materialized (
    select * from private.current_actor()
  ),
  instructor_staff as materialized (
    select staff.id, staff.academy_id
    from actor
    join core.staff_members staff
      on staff.person_id = actor.person_id
     and staff.status = 'active'
    where staff.academy_id in (
      select private.current_academy_ids(array['teacher', 'instructor'])
    )
  )
  select distinct assignment.class_id
  from instructor_staff staff
  join lms.class_instructors assignment
    on assignment.academy_id = staff.academy_id
   and assignment.instructor_staff_id = staff.id
   and assignment.active
   and assignment.started_on <= current_date
   and (assignment.ended_on is null or assignment.ended_on >= current_date)
  join core.classes class_row on class_row.id = assignment.class_id and class_row.active
  union
  select distinct profile.class_id
  from instructor_staff staff
  join lms.class_profiles profile
    on profile.academy_id = staff.academy_id
   and profile.default_instructor_staff_id = staff.id
   and profile.status = 'active'
$$;

alter table lms.subjects enable row level security;
alter table lms.class_target_grades enable row level security;
alter table lms.class_instructors enable row level security;
alter table lms.class_schedule_rule_instructors enable row level security;
alter table lms.lesson_occurrence_instructors enable row level security;
alter table lms.instructor_pay_rates enable row level security;

create policy subjects_select on lms.subjects for select to authenticated
using (academy_id in (select private.current_academy_ids(array['owner','admin','staff','teacher','instructor'])));
create policy subjects_insert on lms.subjects for insert to authenticated
with check (academy_id in (select private.current_academy_ids(array['owner','admin','staff'])));
create policy subjects_update on lms.subjects for update to authenticated
using (academy_id in (select private.current_academy_ids(array['owner','admin','staff'])))
with check (academy_id in (select private.current_academy_ids(array['owner','admin','staff'])));
create policy subjects_delete on lms.subjects for delete to authenticated
using (academy_id in (select private.current_academy_ids(array['owner','admin','staff'])));

create policy class_target_grades_select on lms.class_target_grades for select to authenticated
using (core.can_access_class(class_id));
create policy class_target_grades_write on lms.class_target_grades for all to authenticated
using (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
)
with check (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
);

create policy class_instructors_select on lms.class_instructors for select to authenticated
using (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
  or instructor_staff_id in (select private.current_instructor_staff_ids())
);
create policy class_instructors_write on lms.class_instructors for all to authenticated
using (academy_id in (select private.current_academy_ids(array['owner','admin','staff'])))
with check (academy_id in (select private.current_academy_ids(array['owner','admin','staff'])));

create policy rule_instructors_select on lms.class_schedule_rule_instructors for select to authenticated
using (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
  or instructor_staff_id in (select private.current_instructor_staff_ids())
);
create policy rule_instructors_write on lms.class_schedule_rule_instructors for all to authenticated
using (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
)
with check (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
);

create policy occurrence_instructors_select on lms.lesson_occurrence_instructors for select to authenticated
using (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
  or instructor_staff_id in (select private.current_instructor_staff_ids())
);
create policy occurrence_instructors_write on lms.lesson_occurrence_instructors for all to authenticated
using (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
)
with check (
  academy_id in (select private.current_academy_ids(array['owner','admin','staff']))
  or class_id in (select private.current_assigned_class_ids())
);

create policy instructor_pay_rates_select on lms.instructor_pay_rates for select to authenticated
using (academy_id in (select private.current_academy_ids(array['owner','admin'])));
create policy instructor_pay_rates_write on lms.instructor_pay_rates for all to authenticated
using (academy_id in (select private.current_academy_ids(array['owner','admin'])))
with check (academy_id in (select private.current_academy_ids(array['owner','admin'])));

grant select, insert, update, delete on
  lms.subjects,
  lms.class_target_grades,
  lms.class_instructors,
  lms.class_schedule_rule_instructors,
  lms.lesson_occurrence_instructors,
  lms.instructor_pay_rates
to authenticated;

drop trigger if exists set_subjects_updated_at on lms.subjects;
create trigger set_subjects_updated_at before update on lms.subjects
for each row execute function core.set_updated_at();
drop trigger if exists set_class_target_grades_updated_at on lms.class_target_grades;
create trigger set_class_target_grades_updated_at before update on lms.class_target_grades
for each row execute function core.set_updated_at();
drop trigger if exists set_class_instructors_updated_at on lms.class_instructors;
create trigger set_class_instructors_updated_at before update on lms.class_instructors
for each row execute function core.set_updated_at();
drop trigger if exists set_rule_instructors_updated_at on lms.class_schedule_rule_instructors;
create trigger set_rule_instructors_updated_at before update on lms.class_schedule_rule_instructors
for each row execute function core.set_updated_at();
drop trigger if exists set_occurrence_instructors_updated_at on lms.lesson_occurrence_instructors;
create trigger set_occurrence_instructors_updated_at before update on lms.lesson_occurrence_instructors
for each row execute function core.set_updated_at();
drop trigger if exists set_instructor_pay_rates_updated_at on lms.instructor_pay_rates;
create trigger set_instructor_pay_rates_updated_at before update on lms.instructor_pay_rates
for each row execute function core.set_updated_at();

comment on table lms.class_instructors is
  'Durable class access assignments. Payroll is based on rule/occurrence participants, not this table.';
comment on table lms.lesson_occurrence_instructors is
  'Final effective participant snapshot for a materialized lesson occurrence.';
comment on column ai.conversations.assignment_id is
  'Canonical assignment context validated by the Grade App server; metadata is compatibility-only.';
