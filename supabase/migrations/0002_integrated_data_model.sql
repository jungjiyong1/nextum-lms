-- Integrated NEXTUM data model.
-- This migration keeps the existing LMS and grade-app tables working while
-- adding canonical cross-app schemas for long-term integration.

create extension if not exists pgcrypto;

create schema if not exists core;
create schema if not exists lms;
create schema if not exists content;
create schema if not exists learning;
create schema if not exists ai;
create schema if not exists data;
create schema if not exists reporting;
create schema if not exists audit;

-- ---------------------------------------------------------------------------
-- Shared helpers

create or replace function core.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function content.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- core: canonical people, accounts, students, staff, academy membership

alter table core.academies
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists legacy_lms_academy_id bigint,
  add column if not exists active boolean not null default true,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists core_academies_legacy_lms_academy_id_key
  on core.academies (legacy_lms_academy_id)
  where legacy_lms_academy_id is not null;

do $$
declare
  lms_academy record;
  target_core_academy_id uuid;
begin
  for lms_academy in select id, name, created_at from lms.academies loop
    select id
      into target_core_academy_id
    from core.academies
    where legacy_lms_academy_id = lms_academy.id
    limit 1;

    if target_core_academy_id is null and lms_academy.id = 1 then
      select id
        into target_core_academy_id
      from core.academies
      where legacy_lms_academy_id is null
      order by created_at
      limit 1;
    end if;

    if target_core_academy_id is null then
      insert into core.academies (name, created_at, legacy_lms_academy_id)
      values (lms_academy.name, lms_academy.created_at, lms_academy.id);
    else
      update core.academies
      set legacy_lms_academy_id = lms_academy.id,
          updated_at = now()
      where id = target_core_academy_id;
    end if;
  end loop;
end $$;

create table if not exists core.people (
  id                 uuid primary key default gen_random_uuid(),
  primary_academy_id uuid references core.academies (id) on delete set null,
  full_name          text not null,
  email              text,
  phone              text,
  date_of_birth      date,
  active             boolean not null default true,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists core_people_email_idx
  on core.people (lower(email))
  where email is not null;
create index if not exists core_people_primary_academy_idx on core.people (primary_academy_id);

create table if not exists core.user_accounts (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null unique references auth.users (id) on delete cascade,
  person_id     uuid not null references core.people (id) on delete cascade,
  auth_email    text,
  login_id      text,
  status        text not null default 'active'
                check (status in ('active', 'invited', 'disabled')),
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists core_user_accounts_login_id_key
  on core.user_accounts (lower(login_id))
  where login_id is not null;
create index if not exists core_user_accounts_person_idx on core.user_accounts (person_id);

create table if not exists core.students (
  id                     uuid primary key default gen_random_uuid(),
  academy_id             uuid not null references core.academies (id) on delete cascade,
  person_id              uuid not null references core.people (id) on delete cascade,
  legacy_core_profile_id uuid unique references core.profiles (id) on delete set null,
  legacy_lms_student_id  bigint unique,
  status                 text not null default 'active'
                         check (status in ('active', 'inactive', 'on_leave', 'graduated', 'dropped')),
  school_type            text,
  grade                  text,
  enrollment_date        date,
  notes                  text,
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (academy_id, person_id)
);

create index if not exists core_students_academy_idx on core.students (academy_id);
create index if not exists core_students_person_idx on core.students (person_id);

create table if not exists core.staff_members (
  id                       uuid primary key default gen_random_uuid(),
  academy_id               uuid not null references core.academies (id) on delete cascade,
  person_id                uuid not null references core.people (id) on delete cascade,
  legacy_core_profile_id   uuid unique references core.profiles (id) on delete set null,
  legacy_lms_instructor_id bigint unique,
  role                     text not null default 'staff'
                           check (role in ('owner', 'admin', 'teacher', 'instructor', 'staff')),
  status                   text not null default 'active'
                           check (status in ('active', 'inactive', 'on_leave')),
  hourly_rate              numeric(12, 2),
  qualifications           text,
  hire_date                date,
  notes                    text,
  metadata                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (academy_id, person_id, role)
);

create index if not exists core_staff_members_academy_idx on core.staff_members (academy_id);
create index if not exists core_staff_members_person_idx on core.staff_members (person_id);

create table if not exists core.academy_members (
  id              uuid primary key default gen_random_uuid(),
  academy_id      uuid not null references core.academies (id) on delete cascade,
  person_id       uuid not null references core.people (id) on delete cascade,
  user_account_id uuid references core.user_accounts (id) on delete cascade,
  role            text not null check (role in ('owner', 'admin', 'teacher', 'instructor', 'staff', 'student', 'guardian')),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (academy_id, person_id, role)
);

create index if not exists core_academy_members_person_idx on core.academy_members (person_id);
create index if not exists core_academy_members_account_idx on core.academy_members (user_account_id);

create table if not exists core.user_security_settings (
  user_account_id uuid primary key references core.user_accounts (id) on delete cascade,
  pin_hash        text,
  idle_timeout    integer not null default 10,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists core.account_invitations (
  id               uuid primary key default gen_random_uuid(),
  academy_id       uuid not null references core.academies (id) on delete cascade,
  person_id        uuid references core.people (id) on delete cascade,
  student_id       uuid references core.students (id) on delete cascade,
  staff_member_id  uuid references core.staff_members (id) on delete cascade,
  role             text not null check (role in ('student', 'guardian', 'teacher', 'instructor', 'staff', 'admin')),
  invite_code_hash text not null,
  login_hint       text,
  expires_at       timestamptz not null default (now() + interval '14 days'),
  accepted_at      timestamptz,
  accepted_auth_user_id uuid references auth.users (id) on delete set null,
  created_by       uuid references core.people (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (invite_code_hash)
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'academies', 'people', 'user_accounts', 'students', 'staff_members',
    'academy_members', 'user_security_settings'
  ]
  loop
    execute format('drop trigger if exists set_%I_updated_at on core.%I', table_name, table_name);
    execute format(
      'create trigger set_%I_updated_at before update on core.%I for each row execute function core.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end $$;

-- Map existing grade-app auth profiles into canonical core tables.
insert into core.people (id, primary_academy_id, full_name, phone, active, metadata, created_at)
select
  p.id,
  p.academy_id,
  p.name,
  p.phone,
  p.active,
  jsonb_build_object('legacy_source', 'core.profiles', 'legacy_role', p.role),
  p.created_at
from core.profiles p
on conflict (id) do update set
  primary_academy_id = coalesce(core.people.primary_academy_id, excluded.primary_academy_id),
  full_name = excluded.full_name,
  phone = coalesce(excluded.phone, core.people.phone),
  active = excluded.active,
  metadata = core.people.metadata || excluded.metadata,
  updated_at = now();

insert into core.user_accounts (auth_user_id, person_id, auth_email, status, metadata, created_at)
select
  p.id,
  p.id,
  u.email,
  case when p.active then 'active' else 'disabled' end,
  jsonb_build_object('legacy_source', 'core.profiles'),
  p.created_at
from core.profiles p
left join auth.users u on u.id = p.id
on conflict (auth_user_id) do update set
  person_id = excluded.person_id,
  auth_email = coalesce(excluded.auth_email, core.user_accounts.auth_email),
  status = excluded.status,
  metadata = core.user_accounts.metadata || excluded.metadata,
  updated_at = now();

insert into core.students (id, academy_id, person_id, legacy_core_profile_id, status, created_at)
select
  p.id,
  p.academy_id,
  p.id,
  p.id,
  case when p.active then 'active' else 'inactive' end,
  p.created_at
from core.profiles p
where p.role = 'student'
on conflict (legacy_core_profile_id) do update set
  academy_id = excluded.academy_id,
  person_id = excluded.person_id,
  status = excluded.status,
  updated_at = now();

insert into core.staff_members (id, academy_id, person_id, legacy_core_profile_id, role, status, created_at)
select
  p.id,
  p.academy_id,
  p.id,
  p.id,
  case when p.role = 'owner' then 'owner' else 'teacher' end,
  case when p.active then 'active' else 'inactive' end,
  p.created_at
from core.profiles p
where p.role in ('owner', 'teacher')
on conflict (legacy_core_profile_id) do update set
  academy_id = excluded.academy_id,
  person_id = excluded.person_id,
  role = excluded.role,
  status = excluded.status,
  updated_at = now();

insert into core.academy_members (academy_id, person_id, user_account_id, role, active, created_at)
select
  p.academy_id,
  p.id,
  ua.id,
  case when p.role = 'owner' then 'owner'
       when p.role = 'teacher' then 'teacher'
       else 'student' end,
  p.active,
  p.created_at
from core.profiles p
left join core.user_accounts ua on ua.auth_user_id = p.id
on conflict (academy_id, person_id, role) do update set
  user_account_id = coalesce(excluded.user_account_id, core.academy_members.user_account_id),
  active = excluded.active,
  updated_at = now();

-- Add compatibility pointers to LMS legacy tables.
alter table lms.academies
  add column if not exists core_academy_id uuid references core.academies (id) on delete set null;

update lms.academies la
set core_academy_id = ca.id
from core.academies ca
where ca.legacy_lms_academy_id = la.id
  and la.core_academy_id is distinct from ca.id;

alter table lms.profiles
  add column if not exists core_person_id uuid references core.people (id) on delete set null,
  add column if not exists core_user_account_id uuid references core.user_accounts (id) on delete set null;

insert into core.people (id, primary_academy_id, full_name, email, active, metadata, created_at)
select
  lp.id,
  la.core_academy_id,
  coalesce(lp.full_name, lp.email, 'LMS User'),
  lp.email,
  true,
  jsonb_build_object('legacy_source', 'lms.profiles', 'legacy_role', lp.role),
  lp.created_at
from lms.profiles lp
left join lms.academies la on la.id = lp.current_academy_id
on conflict (id) do update set
  primary_academy_id = coalesce(core.people.primary_academy_id, excluded.primary_academy_id),
  full_name = excluded.full_name,
  email = coalesce(excluded.email, core.people.email),
  metadata = core.people.metadata || excluded.metadata,
  updated_at = now();

insert into core.user_accounts (auth_user_id, person_id, auth_email, status, metadata, created_at)
select
  lp.id,
  lp.id,
  lp.email,
  'active',
  jsonb_build_object('legacy_source', 'lms.profiles'),
  lp.created_at
from lms.profiles lp
on conflict (auth_user_id) do update set
  person_id = excluded.person_id,
  auth_email = coalesce(excluded.auth_email, core.user_accounts.auth_email),
  status = 'active',
  metadata = core.user_accounts.metadata || excluded.metadata,
  updated_at = now();

update lms.profiles lp
set core_person_id = ua.person_id,
    core_user_account_id = ua.id
from core.user_accounts ua
where ua.auth_user_id = lp.id;

insert into core.staff_members (academy_id, person_id, role, status, created_at)
select
  la.core_academy_id,
  lp.core_person_id,
  case when lp.role = 'admin' then 'admin'
       when lp.role = 'instructor' then 'instructor'
       else 'staff' end,
  'active',
  lp.created_at
from lms.profiles lp
join lms.academies la on la.id = lp.current_academy_id
where lp.core_person_id is not null
  and la.core_academy_id is not null
on conflict (academy_id, person_id, role) do update set
  status = 'active',
  updated_at = now();

insert into core.academy_members (academy_id, person_id, user_account_id, role, active, created_at)
select
  la.core_academy_id,
  lp.core_person_id,
  lp.core_user_account_id,
  case when lm.role = 'owner' then 'owner'
       when lm.role = 'admin' then 'admin'
       when lm.role = 'instructor' then 'instructor'
       else 'staff' end,
  lm.active,
  lm.created_at
from lms.academy_members lm
join lms.profiles lp on lp.id = lm.user_id
join lms.academies la on la.id = lm.academy_id
where lp.core_person_id is not null
  and la.core_academy_id is not null
on conflict (academy_id, person_id, role) do update set
  user_account_id = coalesce(excluded.user_account_id, core.academy_members.user_account_id),
  active = excluded.active,
  updated_at = now();

insert into core.user_security_settings (user_account_id, pin_hash, idle_timeout, created_at)
select
  lp.core_user_account_id,
  lp.pin_hash,
  lp.idle_timeout,
  lp.created_at
from lms.profiles lp
where lp.core_user_account_id is not null
on conflict (user_account_id) do update set
  pin_hash = excluded.pin_hash,
  idle_timeout = excluded.idle_timeout,
  updated_at = now();

alter table lms.students
  add column if not exists core_person_id uuid references core.people (id) on delete set null,
  add column if not exists core_student_id uuid references core.students (id) on delete set null;

alter table lms.instructors
  add column if not exists core_person_id uuid references core.people (id) on delete set null,
  add column if not exists core_staff_id uuid references core.staff_members (id) on delete set null;

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

  select id, person_id
    into mapped_student_id, mapped_person_id
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

  select id, person_id
    into mapped_staff_id, mapped_person_id
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

create or replace function lms.sync_profile_to_core()
returns trigger
language plpgsql
security definer
set search_path = lms, core, public
as $$
declare
  mapped_academy_id uuid;
  mapped_account_id uuid;
  mapped_role text;
begin
  select core_academy_id into mapped_academy_id
  from lms.academies
  where id = new.current_academy_id;

  insert into core.people (id, primary_academy_id, full_name, email, active, metadata, created_at)
  values (
    new.id,
    mapped_academy_id,
    coalesce(new.full_name, new.email, 'LMS User'),
    new.email,
    true,
    jsonb_build_object('legacy_source', 'lms.profiles', 'legacy_role', new.role),
    new.created_at
  )
  on conflict (id) do update set
    primary_academy_id = coalesce(excluded.primary_academy_id, core.people.primary_academy_id),
    full_name = excluded.full_name,
    email = coalesce(excluded.email, core.people.email),
    active = true,
    metadata = core.people.metadata || excluded.metadata,
    updated_at = now();

  insert into core.user_accounts (auth_user_id, person_id, auth_email, status, metadata, created_at)
  values (
    new.id,
    new.id,
    new.email,
    'active',
    jsonb_build_object('legacy_source', 'lms.profiles'),
    new.created_at
  )
  on conflict (auth_user_id) do update set
    person_id = excluded.person_id,
    auth_email = coalesce(excluded.auth_email, core.user_accounts.auth_email),
    status = 'active',
    metadata = core.user_accounts.metadata || excluded.metadata,
    updated_at = now()
  returning id into mapped_account_id;

  mapped_role := case when new.role = 'admin' then 'admin'
                      when new.role = 'instructor' then 'instructor'
                      else 'staff' end;

  if mapped_academy_id is not null then
    insert into core.staff_members (academy_id, person_id, role, status)
    values (mapped_academy_id, new.id, mapped_role, 'active')
    on conflict (academy_id, person_id, role) do update set
      status = 'active',
      updated_at = now();

    insert into core.academy_members (academy_id, person_id, user_account_id, role, active)
    values (mapped_academy_id, new.id, mapped_account_id, mapped_role, true)
    on conflict (academy_id, person_id, role) do update set
      user_account_id = excluded.user_account_id,
      active = true,
      updated_at = now();
  end if;

  insert into core.user_security_settings (user_account_id, pin_hash, idle_timeout)
  values (mapped_account_id, new.pin_hash, new.idle_timeout)
  on conflict (user_account_id) do update set
    pin_hash = excluded.pin_hash,
    idle_timeout = excluded.idle_timeout,
    updated_at = now();

  new.core_person_id := new.id;
  new.core_user_account_id := mapped_account_id;
  return new;
end;
$$;

drop trigger if exists sync_profile_to_core on lms.profiles;
create trigger sync_profile_to_core
  before insert or update on lms.profiles
  for each row execute function lms.sync_profile_to_core();

-- Backfill LMS legacy rows through the sync triggers.
update lms.students set updated_at = updated_at;
update lms.instructors set updated_at = updated_at;
update lms.profiles set updated_at = updated_at;

create or replace function core.current_user_account_id()
returns uuid
language sql
stable
security definer
set search_path = core, public
as $$
  select ua.id
  from core.user_accounts ua
  where ua.auth_user_id = (select auth.uid())
    and ua.status = 'active'
  limit 1
$$;

create or replace function core.current_person_id()
returns uuid
language sql
stable
security definer
set search_path = core, public
as $$
  select ua.person_id
  from core.user_accounts ua
  where ua.auth_user_id = (select auth.uid())
    and ua.status = 'active'
  limit 1
$$;

create or replace function core.current_academy_id()
returns uuid
language sql
stable
security definer
set search_path = core, public
as $$
  select am.academy_id
  from core.academy_members am
  join core.user_accounts ua on ua.person_id = am.person_id
  where ua.auth_user_id = (select auth.uid())
    and ua.status = 'active'
    and am.active
  order by
    case am.role
      when 'owner' then 1
      when 'admin' then 2
      when 'staff' then 3
      when 'instructor' then 4
      when 'teacher' then 5
      when 'student' then 6
      else 7
    end,
    am.created_at
  limit 1
$$;

create or replace function core.has_academy_role(check_academy_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1
    from core.academy_members am
    join core.user_accounts ua on ua.person_id = am.person_id
    where ua.auth_user_id = (select auth.uid())
      and ua.status = 'active'
      and am.academy_id = check_academy_id
      and am.active
      and am.role = any(allowed_roles)
  )
$$;

create or replace function core.current_student_id(check_academy_id uuid default null)
returns uuid
language sql
stable
security definer
set search_path = core, public
as $$
  select s.id
  from core.students s
  join core.user_accounts ua on ua.person_id = s.person_id
  where ua.auth_user_id = (select auth.uid())
    and ua.status = 'active'
    and (check_academy_id is null or s.academy_id = check_academy_id)
    and s.status = 'active'
  order by s.created_at
  limit 1
$$;

create or replace function core.can_access_student(check_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1
    from core.students s
    join core.user_accounts ua on ua.person_id = s.person_id
    where s.id = check_student_id
      and ua.auth_user_id = (select auth.uid())
      and ua.status = 'active'
  )
  or exists (
    select 1
    from core.students s
    join core.academy_members am on am.academy_id = s.academy_id
    join core.user_accounts ua on ua.person_id = am.person_id
    where s.id = check_student_id
      and ua.auth_user_id = (select auth.uid())
      and ua.status = 'active'
      and am.active
      and am.role in ('owner', 'admin', 'staff', 'instructor', 'teacher')
  )
$$;

alter table core.people enable row level security;
alter table core.user_accounts enable row level security;
alter table core.students enable row level security;
alter table core.staff_members enable row level security;
alter table core.academy_members enable row level security;
alter table core.user_security_settings enable row level security;
alter table core.account_invitations enable row level security;

drop policy if exists people_access on core.people;
create policy people_access on core.people
  for select to authenticated
  using (
    id = core.current_person_id()
    or exists (
      select 1
      from core.students s
      where s.person_id = people.id
        and core.has_academy_role(s.academy_id, array['owner','admin','staff','instructor','teacher'])
    )
    or exists (
      select 1
      from core.staff_members sm
      where sm.person_id = people.id
        and core.has_academy_role(sm.academy_id, array['owner','admin','staff'])
    )
  );

drop policy if exists people_insert_staff on core.people;
create policy people_insert_staff on core.people
  for insert to authenticated
  with check (
    primary_academy_id is null
    or core.has_academy_role(primary_academy_id, array['owner','admin','staff'])
  );

drop policy if exists people_update_staff on core.people;
create policy people_update_staff on core.people
  for update to authenticated
  using (
    id = core.current_person_id()
    or primary_academy_id is null
    or core.has_academy_role(primary_academy_id, array['owner','admin','staff'])
  )
  with check (
    id = core.current_person_id()
    or primary_academy_id is null
    or core.has_academy_role(primary_academy_id, array['owner','admin','staff'])
  );

drop policy if exists user_accounts_self on core.user_accounts;
create policy user_accounts_self on core.user_accounts
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

drop policy if exists students_access on core.students;
create policy students_access on core.students
  for select to authenticated
  using (
    id = core.current_student_id(academy_id)
    or core.has_academy_role(academy_id, array['owner','admin','staff','instructor','teacher'])
  );

drop policy if exists students_staff_write on core.students;
create policy students_staff_write on core.students
  for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));

drop policy if exists staff_members_access on core.staff_members;
create policy staff_members_access on core.staff_members
  for select to authenticated
  using (
    person_id = core.current_person_id()
    or core.has_academy_role(academy_id, array['owner','admin','staff'])
  );

drop policy if exists staff_members_admin_write on core.staff_members;
create policy staff_members_admin_write on core.staff_members
  for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin']))
  with check (core.has_academy_role(academy_id, array['owner','admin']));

drop policy if exists academy_members_access on core.academy_members;
create policy academy_members_access on core.academy_members
  for select to authenticated
  using (
    person_id = core.current_person_id()
    or core.has_academy_role(academy_id, array['owner','admin','staff'])
  );

drop policy if exists academy_members_admin_write on core.academy_members;
create policy academy_members_admin_write on core.academy_members
  for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin']))
  with check (core.has_academy_role(academy_id, array['owner','admin']));

drop policy if exists user_security_settings_self on core.user_security_settings;
create policy user_security_settings_self on core.user_security_settings
  for all to authenticated
  using (user_account_id = core.current_user_account_id())
  with check (user_account_id = core.current_user_account_id());

drop policy if exists account_invitations_staff on core.account_invitations;
create policy account_invitations_staff on core.account_invitations
  for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));

-- ---------------------------------------------------------------------------
-- content: canonical books/problem catalog copied from legacy learning tables

create table if not exists content.books (
  id               uuid primary key default gen_random_uuid(),
  book_key         text not null unique,
  title            text not null,
  subject          text,
  grade            text,
  schema_version   int not null,
  pipeline_version text,
  imported_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists content.units (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references content.books (id) on delete cascade,
  unit_key   text not null,
  part_name  text not null,
  name       text not null,
  page_start int,
  page_end   int,
  sort_order int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, unit_key)
);

create table if not exists content.concepts (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references content.books (id) on delete cascade,
  name       text not null,
  name_raw   text,
  detail     jsonb,
  sort_order int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, name)
);

create table if not exists content.problem_types (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references content.books (id) on delete cascade,
  concept_id uuid references content.concepts (id) on delete set null,
  name       text not null,
  name_raw   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, name)
);

create table if not exists content.problems (
  id                text primary key,
  book_id           uuid not null references content.books (id) on delete cascade,
  unit_id           uuid not null references content.units (id) on delete cascade,
  type_id           uuid references content.problem_types (id) on delete set null,
  concept_id        uuid references content.concepts (id) on delete set null,
  page_printed      int not null,
  number            text not null,
  image_path        text,
  answer_image_path text,
  answer            jsonb not null,
  position_in_type  int,
  is_example        boolean not null default false,
  difficulty_hint   text,
  verified          boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists content.assets (
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid references content.books (id) on delete cascade,
  problem_id   text references content.problems (id) on delete cascade,
  storage_path text not null,
  asset_type   text not null default 'image',
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create table if not exists content.problem_reports (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid references core.students (id) on delete set null,
  legacy_auth_user_id uuid references auth.users (id) on delete set null,
  problem_id      text not null references content.problems (id) on delete cascade,
  reason          text not null,
  status          text not null default 'open' check (status in ('open', 'fixed', 'rejected')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists content_units_book_idx on content.units (book_id);
create index if not exists content_concepts_book_idx on content.concepts (book_id);
create index if not exists content_problem_types_book_idx on content.problem_types (book_id);
create index if not exists content_problems_book_unit_idx on content.problems (book_id, unit_id);
create index if not exists content_problems_type_idx on content.problems (type_id) where type_id is not null;
create index if not exists content_problems_concept_idx on content.problems (concept_id) where concept_id is not null;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'books', 'units', 'concepts', 'problem_types', 'problems', 'problem_reports'
  ]
  loop
    execute format('drop trigger if exists set_%I_updated_at on content.%I', table_name, table_name);
    execute format(
      'create trigger set_%I_updated_at before update on content.%I for each row execute function content.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end $$;

insert into content.books (
  id, book_key, title, subject, grade, schema_version, pipeline_version, imported_at, created_at
)
select id, book_key, title, subject, grade, schema_version, pipeline_version, imported_at, imported_at
from learning.books
on conflict (id) do update set
  book_key = excluded.book_key,
  title = excluded.title,
  subject = excluded.subject,
  grade = excluded.grade,
  schema_version = excluded.schema_version,
  pipeline_version = excluded.pipeline_version,
  imported_at = excluded.imported_at,
  updated_at = now();

insert into content.units (
  id, book_id, unit_key, part_name, name, page_start, page_end, sort_order
)
select id, book_id, unit_key, part_name, name, page_start, page_end, sort_order
from learning.units
on conflict (id) do update set
  book_id = excluded.book_id,
  unit_key = excluded.unit_key,
  part_name = excluded.part_name,
  name = excluded.name,
  page_start = excluded.page_start,
  page_end = excluded.page_end,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into content.concepts (
  id, book_id, name, name_raw, detail, sort_order
)
select id, book_id, name, name_raw, detail, sort_order
from learning.concepts
on conflict (id) do update set
  book_id = excluded.book_id,
  name = excluded.name,
  name_raw = excluded.name_raw,
  detail = excluded.detail,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into content.problem_types (
  id, book_id, concept_id, name, name_raw
)
select id, book_id, concept_id, name, name_raw
from learning.types
on conflict (id) do update set
  book_id = excluded.book_id,
  concept_id = excluded.concept_id,
  name = excluded.name,
  name_raw = excluded.name_raw,
  updated_at = now();

insert into content.problems (
  id, book_id, unit_id, type_id, concept_id, page_printed, number, image_path,
  answer_image_path, answer, position_in_type, is_example, difficulty_hint, verified
)
select
  id, book_id, unit_id, type_id, concept_id, page_printed, number, image_path,
  answer_image_path, answer, position_in_type, is_example, difficulty_hint, verified
from learning.problems
on conflict (id) do update set
  book_id = excluded.book_id,
  unit_id = excluded.unit_id,
  type_id = excluded.type_id,
  concept_id = excluded.concept_id,
  page_printed = excluded.page_printed,
  number = excluded.number,
  image_path = excluded.image_path,
  answer_image_path = excluded.answer_image_path,
  answer = excluded.answer,
  position_in_type = excluded.position_in_type,
  is_example = excluded.is_example,
  difficulty_hint = excluded.difficulty_hint,
  verified = excluded.verified,
  updated_at = now();

insert into content.problem_reports (
  id, student_id, legacy_auth_user_id, problem_id, reason, status, created_at
)
select
  r.id,
  s.id,
  r.student_id,
  r.problem_id,
  r.reason,
  r.status,
  r.created_at
from learning.reports r
left join core.students s on s.legacy_core_profile_id = r.student_id
on conflict (id) do update set
  student_id = excluded.student_id,
  legacy_auth_user_id = excluded.legacy_auth_user_id,
  problem_id = excluded.problem_id,
  reason = excluded.reason,
  status = excluded.status,
  updated_at = now();

alter table content.books enable row level security;
alter table content.units enable row level security;
alter table content.concepts enable row level security;
alter table content.problem_types enable row level security;
alter table content.problems enable row level security;
alter table content.assets enable row level security;
alter table content.problem_reports enable row level security;

drop policy if exists content_authenticated_read_books on content.books;
create policy content_authenticated_read_books on content.books
  for select to authenticated using (true);
drop policy if exists content_authenticated_read_units on content.units;
create policy content_authenticated_read_units on content.units
  for select to authenticated using (true);
drop policy if exists content_authenticated_read_concepts on content.concepts;
create policy content_authenticated_read_concepts on content.concepts
  for select to authenticated using (true);
drop policy if exists content_authenticated_read_problem_types on content.problem_types;
create policy content_authenticated_read_problem_types on content.problem_types
  for select to authenticated using (true);
drop policy if exists content_authenticated_read_problems on content.problems;
create policy content_authenticated_read_problems on content.problems
  for select to authenticated using (true);
drop policy if exists content_authenticated_read_assets on content.assets;
create policy content_authenticated_read_assets on content.assets
  for select to authenticated using (true);

drop policy if exists problem_reports_student_insert on content.problem_reports;
create policy problem_reports_student_insert on content.problem_reports
  for insert to authenticated
  with check (
    student_id is null
    or core.can_access_student(student_id)
  );

drop policy if exists problem_reports_access on content.problem_reports;
create policy problem_reports_access on content.problem_reports
  for select to authenticated
  using (
    student_id is null
    or core.can_access_student(student_id)
  );

-- ---------------------------------------------------------------------------
-- learning: canonical assignment layer and core_student_id compatibility

alter table learning.sessions
  add column if not exists core_student_id uuid references core.students (id) on delete set null;
alter table learning.attempts
  add column if not exists core_student_id uuid references core.students (id) on delete set null;
alter table learning.wrong_notes
  add column if not exists core_student_id uuid references core.students (id) on delete set null;
alter table learning.reports
  add column if not exists core_student_id uuid references core.students (id) on delete set null;

update learning.sessions s
set core_student_id = cs.id
from core.students cs
where cs.legacy_core_profile_id = s.student_id
  and s.core_student_id is null;

update learning.attempts a
set core_student_id = cs.id
from core.students cs
where cs.legacy_core_profile_id = a.student_id
  and a.core_student_id is null;

update learning.wrong_notes wn
set core_student_id = cs.id
from core.students cs
where cs.legacy_core_profile_id = wn.student_id
  and wn.core_student_id is null;

update learning.reports r
set core_student_id = cs.id
from core.students cs
where cs.legacy_core_profile_id = r.student_id
  and r.core_student_id is null;

create index if not exists learning_sessions_core_student_idx on learning.sessions (core_student_id, started_at desc);
create index if not exists learning_attempts_core_student_idx on learning.attempts (core_student_id, created_at desc);
create index if not exists learning_wrong_notes_core_student_idx on learning.wrong_notes (core_student_id);
create index if not exists learning_reports_core_student_idx on learning.reports (core_student_id);

create table if not exists learning.assignments (
  id            uuid primary key default gen_random_uuid(),
  academy_id    uuid not null references core.academies (id) on delete cascade,
  book_id       uuid not null references content.books (id) on delete cascade,
  unit_id       uuid references content.units (id) on delete set null,
  problem_id    text references content.problems (id) on delete set null,
  title         text not null,
  description   text,
  context       text not null default 'homework'
                check (context in ('homework','free','retry','drill','diagnostic')),
  due_at        timestamptz,
  created_by    uuid references core.people (id) on delete set null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists learning.assignment_targets (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references learning.assignments (id) on delete cascade,
  target_type    text not null check (target_type in ('academy','lesson','student')),
  student_id     uuid references core.students (id) on delete cascade,
  lms_lesson_id  bigint references lms.lessons (id) on delete cascade,
  created_at     timestamptz not null default now(),
  check (
    (target_type = 'academy' and student_id is null and lms_lesson_id is null)
    or (target_type = 'student' and student_id is not null and lms_lesson_id is null)
    or (target_type = 'lesson' and student_id is null and lms_lesson_id is not null)
  )
);

create unique index if not exists learning_assignment_targets_student_key
  on learning.assignment_targets (assignment_id, student_id)
  where target_type = 'student';
create unique index if not exists learning_assignment_targets_lesson_key
  on learning.assignment_targets (assignment_id, lms_lesson_id)
  where target_type = 'lesson';
create unique index if not exists learning_assignment_targets_academy_key
  on learning.assignment_targets (assignment_id)
  where target_type = 'academy';

drop trigger if exists set_assignments_updated_at on learning.assignments;
create trigger set_assignments_updated_at
  before update on learning.assignments
  for each row execute function core.set_updated_at();

alter table learning.assignments enable row level security;
alter table learning.assignment_targets enable row level security;

drop policy if exists assignments_access on learning.assignments;
create policy assignments_access on learning.assignments
  for select to authenticated
  using (
    core.has_academy_role(academy_id, array['owner','admin','staff','instructor','teacher'])
    or exists (
      select 1
      from learning.assignment_targets at
      where at.assignment_id = assignments.id
        and (
          at.target_type = 'academy'
          or (at.target_type = 'student' and at.student_id = core.current_student_id(assignments.academy_id))
          or (
            at.target_type = 'lesson'
            and exists (
              select 1
              from lms.enrollments e
              where e.lesson_id = at.lms_lesson_id
                and e.status in ('enrolled', 'active')
                and e.student_id in (
                  select legacy_lms_student_id
                  from core.students
                  where id = core.current_student_id(assignments.academy_id)
                )
            )
          )
        )
    )
  );

drop policy if exists assignments_staff_write on learning.assignments;
create policy assignments_staff_write on learning.assignments
  for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff','instructor','teacher']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff','instructor','teacher']));

drop policy if exists assignment_targets_access on learning.assignment_targets;
create policy assignment_targets_access on learning.assignment_targets
  for select to authenticated
  using (
    exists (
      select 1
      from learning.assignments a
      where a.id = assignment_targets.assignment_id
        and (
          core.has_academy_role(a.academy_id, array['owner','admin','staff','instructor','teacher'])
          or assignment_targets.student_id = core.current_student_id(a.academy_id)
          or assignment_targets.target_type = 'academy'
        )
    )
  );

drop policy if exists assignment_targets_staff_write on learning.assignment_targets;
create policy assignment_targets_staff_write on learning.assignment_targets
  for all to authenticated
  using (
    exists (
      select 1 from learning.assignments a
      where a.id = assignment_targets.assignment_id
        and core.has_academy_role(a.academy_id, array['owner','admin','staff','instructor','teacher'])
    )
  )
  with check (
    exists (
      select 1 from learning.assignments a
      where a.id = assignment_targets.assignment_id
        and core.has_academy_role(a.academy_id, array['owner','admin','staff','instructor','teacher'])
    )
  );

drop policy if exists sessions_own_core on learning.sessions;
create policy sessions_own_core on learning.sessions
  for all to authenticated
  using (
    student_id = (select auth.uid())
    or (core_student_id is not null and core.can_access_student(core_student_id))
  )
  with check (
    student_id = (select auth.uid())
    or (core_student_id is not null and core.can_access_student(core_student_id))
  );

drop policy if exists attempts_select_core on learning.attempts;
create policy attempts_select_core on learning.attempts
  for select to authenticated
  using (
    student_id = (select auth.uid())
    or (core_student_id is not null and core.can_access_student(core_student_id))
  );

drop policy if exists attempts_insert_core on learning.attempts;
create policy attempts_insert_core on learning.attempts
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    or (core_student_id is not null and core.can_access_student(core_student_id))
  );

-- ---------------------------------------------------------------------------
-- ai / data / audit

create table if not exists ai.conversations (
  id             uuid primary key default gen_random_uuid(),
  academy_id     uuid references core.academies (id) on delete cascade,
  student_id     uuid references core.students (id) on delete cascade,
  session_id     uuid references learning.sessions (id) on delete set null,
  problem_id     text references content.problems (id) on delete set null,
  source_app     text not null default 'grade_app',
  title          text,
  status         text not null default 'open' check (status in ('open','archived')),
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists ai.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai.conversations (id) on delete cascade,
  role            text not null check (role in ('system','user','assistant','tool')),
  content         text not null,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create table if not exists ai.attachments (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references ai.conversations (id) on delete cascade,
  message_id      uuid references ai.messages (id) on delete cascade,
  storage_path    text not null,
  media_type      text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create table if not exists data.events (
  id            uuid primary key default gen_random_uuid(),
  academy_id    uuid references core.academies (id) on delete set null,
  student_id    uuid references core.students (id) on delete set null,
  source_app    text not null,
  event_type    text not null,
  entity_schema text,
  entity_table  text,
  entity_id     text,
  occurred_at   timestamptz not null default now(),
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists data_events_student_time_idx on data.events (student_id, occurred_at desc);
create index if not exists data_events_academy_time_idx on data.events (academy_id, occurred_at desc);
create index if not exists data_events_type_time_idx on data.events (event_type, occurred_at desc);

create table if not exists audit.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  academy_id    uuid references core.academies (id) on delete set null,
  actor_person_id uuid references core.people (id) on delete set null,
  action        text not null,
  entity_schema text,
  entity_table  text,
  entity_id     text,
  before_data   jsonb,
  after_data    jsonb,
  created_at    timestamptz not null default now()
);

alter table ai.conversations enable row level security;
alter table ai.messages enable row level security;
alter table ai.attachments enable row level security;
alter table data.events enable row level security;
alter table audit.audit_logs enable row level security;

drop policy if exists ai_conversations_access on ai.conversations;
create policy ai_conversations_access on ai.conversations
  for all to authenticated
  using (
    (student_id is not null and core.can_access_student(student_id))
    or (academy_id is not null and core.has_academy_role(academy_id, array['owner','admin','staff','instructor','teacher']))
  )
  with check (
    (student_id is not null and core.can_access_student(student_id))
    or (academy_id is not null and core.has_academy_role(academy_id, array['owner','admin','staff','instructor','teacher']))
  );

drop policy if exists ai_messages_access on ai.messages;
create policy ai_messages_access on ai.messages
  for all to authenticated
  using (
    exists (
      select 1 from ai.conversations c
      where c.id = messages.conversation_id
        and (
          (c.student_id is not null and core.can_access_student(c.student_id))
          or (c.academy_id is not null and core.has_academy_role(c.academy_id, array['owner','admin','staff','instructor','teacher']))
        )
    )
  )
  with check (
    exists (
      select 1 from ai.conversations c
      where c.id = messages.conversation_id
        and (
          (c.student_id is not null and core.can_access_student(c.student_id))
          or (c.academy_id is not null and core.has_academy_role(c.academy_id, array['owner','admin','staff','instructor','teacher']))
        )
    )
  );

drop policy if exists ai_attachments_access on ai.attachments;
create policy ai_attachments_access on ai.attachments
  for all to authenticated
  using (
    exists (
      select 1 from ai.conversations c
      where c.id = attachments.conversation_id
        and (
          (c.student_id is not null and core.can_access_student(c.student_id))
          or (c.academy_id is not null and core.has_academy_role(c.academy_id, array['owner','admin','staff','instructor','teacher']))
        )
    )
  )
  with check (
    exists (
      select 1 from ai.conversations c
      where c.id = attachments.conversation_id
        and (
          (c.student_id is not null and core.can_access_student(c.student_id))
          or (c.academy_id is not null and core.has_academy_role(c.academy_id, array['owner','admin','staff','instructor','teacher']))
        )
    )
  );

drop policy if exists data_events_access on data.events;
create policy data_events_access on data.events
  for all to authenticated
  using (
    (student_id is not null and core.can_access_student(student_id))
    or (academy_id is not null and core.has_academy_role(academy_id, array['owner','admin','staff','instructor','teacher']))
  )
  with check (
    (student_id is null or core.can_access_student(student_id))
    and (academy_id is null or core.has_academy_role(academy_id, array['owner','admin','staff','instructor','teacher']))
  );

drop policy if exists audit_logs_admin_read on audit.audit_logs;
create policy audit_logs_admin_read on audit.audit_logs
  for select to authenticated
  using (
    academy_id is not null
    and core.has_academy_role(academy_id, array['owner','admin'])
  );

-- ---------------------------------------------------------------------------
-- reporting: read-optimized views for LMS/report generation

create or replace view reporting.student_roster
with (security_invoker = on)
as
select
  s.id as student_id,
  s.academy_id,
  p.full_name as name,
  p.email,
  p.phone,
  p.date_of_birth,
  s.status,
  s.school_type,
  s.grade,
  s.enrollment_date,
  s.legacy_core_profile_id,
  s.legacy_lms_student_id,
  s.created_at,
  s.updated_at
from core.students s
join core.people p on p.id = s.person_id;

create or replace view reporting.student_learning_summary
with (security_invoker = on)
as
select
  s.id as student_id,
  s.academy_id,
  p.full_name as student_name,
  count(distinct ls.id)::int as session_count,
  count(la.id)::int as attempt_count,
  count(la.id) filter (where la.correct)::int as correct_count,
  max(la.created_at) as last_attempt_at
from core.students s
join core.people p on p.id = s.person_id
left join learning.sessions ls on ls.core_student_id = s.id
left join learning.attempts la on la.core_student_id = s.id
group by s.id, s.academy_id, p.full_name;

create or replace view reporting.submission_status
with (security_invoker = on)
as
select
  coalesce(s.core_student_id, s.student_id) as student_id,
  s.core_student_id,
  s.student_id as legacy_auth_user_id,
  s.book_id,
  s.id as session_id,
  s.context,
  s.scope_label,
  count(a.id)::int as answered_count,
  count(a.id) filter (where a.correct)::int as correct_count,
  s.started_at,
  s.submitted_at
from learning.sessions s
left join learning.attempts a on a.session_id = s.id
group by s.id, s.core_student_id, s.student_id, s.book_id, s.context, s.scope_label, s.started_at, s.submitted_at;

create or replace view reporting.student_problem_weakness
with (security_invoker = on)
as
with first_tries as (
  select
    coalesce(a.core_student_id, a.student_id) as student_id,
    a.core_student_id,
    a.student_id as legacy_auth_user_id,
    a.problem_id,
    bool_and(a.correct) as correct,
    bool_or(a.unsure) as unsure,
    max(a.created_at) as at
  from learning.attempts a
  where a.attempt_no = 1
  group by coalesce(a.core_student_id, a.student_id), a.core_student_id, a.student_id, a.problem_id
),
scored as (
  select
    f.student_id,
    f.core_student_id,
    f.legacy_auth_user_id,
    p.book_id,
    p.unit_id,
    p.type_id,
    coalesce(p.concept_id, pt.concept_id) as concept_id,
    case when f.correct and f.unsure then 0.5
         when f.correct then 1.0
         else 0.0 end as score,
    f.at
  from first_tries f
  join content.problems p on p.id = f.problem_id
  left join content.problem_types pt on pt.id = p.type_id
)
select
  s.student_id,
  s.core_student_id,
  s.legacy_auth_user_id,
  s.book_id,
  s.unit_id,
  u.name as unit_name,
  s.concept_id,
  c.name as concept_name,
  s.type_id,
  pt.name as type_name,
  count(*)::int as n_first_try,
  sum(s.score) as first_try_correct,
  max(s.at) as last_attempt_at,
  case
    when count(*) < 2 then 'insufficient'
    when sum(s.score) / count(*) < 0.5 then 'weak'
    when sum(s.score) / count(*) < 0.75 then 'watch'
    else 'ok'
  end as status
from scored s
join content.units u on u.id = s.unit_id
left join content.concepts c on c.id = s.concept_id
left join content.problem_types pt on pt.id = s.type_id
group by
  s.student_id, s.core_student_id, s.legacy_auth_user_id, s.book_id,
  s.unit_id, u.name, s.concept_id, c.name, s.type_id, pt.name;

-- ---------------------------------------------------------------------------
-- Grants / Data API exposure

grant usage on schema core, lms, content, learning, ai, data, reporting, audit
  to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema core to authenticated;
grant select, insert, update, delete on all tables in schema lms to authenticated;
grant select on all tables in schema content to authenticated;
grant insert, update on content.problem_reports to authenticated;
grant select, insert, update, delete on learning.assignments, learning.assignment_targets to authenticated;
grant select, insert, update, delete on all tables in schema ai to authenticated;
grant select, insert on all tables in schema data to authenticated;
grant select on all tables in schema reporting to authenticated;
grant select on all tables in schema audit to authenticated;

grant usage, select on all sequences in schema core, lms, content, learning, ai, data, audit
  to authenticated;

grant all on all tables in schema core, lms, content, learning, ai, data, reporting, audit
  to service_role;
grant usage, select on all sequences in schema core, lms, content, learning, ai, data, audit
  to service_role;

alter default privileges in schema core grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema content grant select on tables to authenticated;
alter default privileges in schema learning grant select on tables to authenticated;
alter default privileges in schema ai grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema data grant select, insert on tables to authenticated;
alter default privileges in schema reporting grant select on tables to authenticated;
alter default privileges in schema audit grant select on tables to authenticated;

grant execute on function core.current_user_account_id() to authenticated;
grant execute on function core.current_person_id() to authenticated;
grant execute on function core.current_academy_id() to authenticated;
grant execute on function core.has_academy_role(uuid, text[]) to authenticated;
grant execute on function core.current_student_id(uuid) to authenticated;
grant execute on function core.can_access_student(uuid) to authenticated;

alter role authenticator set pgrst.db_schemas = 'public, graphql_public, core, lms, content, learning, ai, data, reporting, audit';
notify pgrst, 'reload config';
