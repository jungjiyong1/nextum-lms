-- Compatibility layer for LMS while the UI still uses numeric legacy IDs.

create or replace function core.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function lms.sync_student_to_core()
returns trigger
language plpgsql
security definer
set search_path = lms, core, public
as $$
declare
  mapped_academy_id uuid;
  mapped_person_id uuid;
  mapped_student_id uuid;
begin
  select core_academy_id into mapped_academy_id
  from lms.academies
  where id = new.academy_id;

  if mapped_academy_id is null then
    return new;
  end if;

  select id, person_id into mapped_student_id, mapped_person_id
  from core.students
  where legacy_lms_student_id = new.id;

  mapped_person_id := coalesce(mapped_person_id, new.core_person_id, gen_random_uuid());

  insert into core.people (
    id, primary_academy_id, full_name, email, phone, date_of_birth,
    active, metadata, created_at
  )
  values (
    mapped_person_id,
    mapped_academy_id,
    new.name,
    new.email,
    new.phone,
    new.date_of_birth,
    new.status = 'active',
    jsonb_build_object(
      'legacy_source', 'lms.students',
      'legacy_lms_student_id', new.id,
      'parent_name', new.parent_name,
      'parent_phone', new.parent_phone,
      'monthly_tuition', new.monthly_tuition,
      'payment_cycle_day', new.payment_cycle_day
    ),
    new.created_at
  )
  on conflict (id) do update set
    primary_academy_id = excluded.primary_academy_id,
    full_name = excluded.full_name,
    email = excluded.email,
    phone = excluded.phone,
    date_of_birth = excluded.date_of_birth,
    active = excluded.active,
    metadata = core.people.metadata || excluded.metadata,
    updated_at = now();

  insert into core.students (
    id, academy_id, person_id, legacy_lms_student_id, status,
    school_type, grade, enrollment_date, notes, created_at
  )
  values (
    coalesce(mapped_student_id, new.core_student_id, gen_random_uuid()),
    mapped_academy_id,
    mapped_person_id,
    new.id,
    new.status,
    new.school_type,
    new.grade,
    new.enrollment_date,
    new.notes,
    new.created_at
  )
  on conflict (legacy_lms_student_id) do update set
    academy_id = excluded.academy_id,
    person_id = excluded.person_id,
    status = excluded.status,
    school_type = excluded.school_type,
    grade = excluded.grade,
    enrollment_date = excluded.enrollment_date,
    notes = excluded.notes,
    updated_at = now()
  returning id, person_id into mapped_student_id, mapped_person_id;

  new.core_person_id := mapped_person_id;
  new.core_student_id := mapped_student_id;
  return new;
end;
$$;

drop trigger if exists sync_student_to_core on lms.students;
create trigger sync_student_to_core
  before insert or update on lms.students
  for each row execute function lms.sync_student_to_core();

create or replace function lms.sync_instructor_to_core()
returns trigger
language plpgsql
security definer
set search_path = lms, core, public
as $$
declare
  mapped_academy_id uuid;
  mapped_person_id uuid;
  mapped_staff_id uuid;
begin
  select core_academy_id into mapped_academy_id
  from lms.academies
  where id = new.academy_id;

  if mapped_academy_id is null then
    return new;
  end if;

  select id, person_id into mapped_staff_id, mapped_person_id
  from core.staff_members
  where legacy_lms_instructor_id = new.id;

  mapped_person_id := coalesce(mapped_person_id, new.core_person_id, gen_random_uuid());

  insert into core.people (
    id, primary_academy_id, full_name, email, phone, active, metadata, created_at
  )
  values (
    mapped_person_id,
    mapped_academy_id,
    new.name,
    new.email,
    new.phone,
    new.status = 'active',
    jsonb_build_object('legacy_source', 'lms.instructors', 'legacy_lms_instructor_id', new.id),
    new.created_at
  )
  on conflict (id) do update set
    primary_academy_id = excluded.primary_academy_id,
    full_name = excluded.full_name,
    email = excluded.email,
    phone = excluded.phone,
    active = excluded.active,
    metadata = core.people.metadata || excluded.metadata,
    updated_at = now();

  insert into core.staff_members (
    id, academy_id, person_id, legacy_lms_instructor_id, role, status,
    hourly_rate, qualifications, hire_date, notes, created_at
  )
  values (
    coalesce(mapped_staff_id, new.core_staff_id, gen_random_uuid()),
    mapped_academy_id,
    mapped_person_id,
    new.id,
    'instructor',
    new.status,
    new.hourly_rate,
    new.qualifications,
    new.hire_date,
    new.notes,
    new.created_at
  )
  on conflict (legacy_lms_instructor_id) do update set
    academy_id = excluded.academy_id,
    person_id = excluded.person_id,
    status = excluded.status,
    hourly_rate = excluded.hourly_rate,
    qualifications = excluded.qualifications,
    hire_date = excluded.hire_date,
    notes = excluded.notes,
    updated_at = now()
  returning id, person_id into mapped_staff_id, mapped_person_id;

  insert into core.academy_members (academy_id, person_id, role, active)
  values (mapped_academy_id, mapped_person_id, 'instructor', new.status = 'active')
  on conflict (academy_id, person_id, role) do update set
    active = excluded.active,
    updated_at = now();

  new.core_person_id := mapped_person_id;
  new.core_staff_id := mapped_staff_id;
  return new;
end;
$$;

drop trigger if exists sync_instructor_to_core on lms.instructors;
create trigger sync_instructor_to_core
  before insert or update on lms.instructors
  for each row execute function lms.sync_instructor_to_core();

update lms.students set updated_at = updated_at;
update lms.instructors set updated_at = updated_at;

create or replace view reporting.lms_student_roster
with (security_invoker = on)
as
select
  s.legacy_lms_student_id as legacy_lms_id,
  s.legacy_lms_student_id as legacy_id,
  s.legacy_lms_student_id as lms_student_id,
  s.id as core_student_id,
  s.academy_id,
  p.full_name as name,
  p.email,
  p.phone,
  p.date_of_birth,
  s.enrollment_date,
  s.status,
  p.metadata->>'parent_name' as parent_name,
  p.metadata->>'parent_phone' as parent_phone,
  nullif(p.metadata->>'monthly_tuition', '')::numeric as monthly_tuition,
  coalesce(nullif(p.metadata->>'payment_cycle_day', '')::int, 1) as payment_cycle_day,
  null::date as last_payment_date,
  s.notes,
  s.school_type,
  s.grade,
  s.created_at,
  s.updated_at
from core.students s
join core.people p on p.id = s.person_id
where s.legacy_lms_student_id is not null;

create or replace view reporting.lms_instructor_roster
with (security_invoker = on)
as
select
  sm.legacy_lms_instructor_id as legacy_lms_id,
  sm.legacy_lms_instructor_id as legacy_id,
  sm.legacy_lms_instructor_id as lms_instructor_id,
  sm.id as core_staff_id,
  sm.academy_id,
  p.full_name as name,
  p.email,
  p.phone,
  sm.hourly_rate,
  sm.qualifications,
  sm.hire_date,
  sm.status,
  sm.notes,
  sm.role,
  sm.created_at,
  sm.updated_at
from core.staff_members sm
join core.people p on p.id = sm.person_id
where sm.legacy_lms_instructor_id is not null;

grant select on reporting.lms_student_roster, reporting.lms_instructor_roster
  to authenticated, service_role;

notify pgrst, 'reload schema';
