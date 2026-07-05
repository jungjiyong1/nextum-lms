-- LMS schema for the Electron app.
-- Keep this separate from grade-app:
--   core     = shared roster contract used by grade-app
--   learning = grade-app owned grading/learning data
--   lms      = LMS desktop app owned operational data

create schema if not exists lms;

create table if not exists lms.academies (
  id         bigserial primary key,
  name       text not null,
  owner_id   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into lms.academies (id, name)
values (1, 'Nextum LMS')
on conflict (id) do nothing;

select setval(
  pg_get_serial_sequence('lms.academies', 'id'),
  greatest((select max(id) from lms.academies), 1),
  true
);

create table if not exists lms.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text unique,
  full_name          text,
  role               text not null default 'staff'
                     check (role in ('admin', 'instructor', 'staff')),
  current_academy_id bigint references lms.academies (id),
  pin_hash           text,
  idle_timeout       integer not null default 10,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists lms.academy_members (
  id         bigserial primary key,
  academy_id bigint not null references lms.academies (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'staff'
             check (role in ('owner', 'admin', 'instructor', 'staff')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (academy_id, user_id)
);

create or replace function lms.current_academy_id()
returns bigint
language sql
stable
security definer
set search_path = lms, public
as $$
  select p.current_academy_id
  from lms.profiles p
  where p.id = auth.uid()
$$;

create or replace function lms.belongs_to_current_academy(check_academy_id bigint)
returns boolean
language sql
stable
security definer
set search_path = lms, public
as $$
  select exists (
    select 1
    from lms.academy_members m
    where m.user_id = auth.uid()
      and m.academy_id = check_academy_id
      and m.active
  )
$$;

create or replace function lms.default_academy_id()
returns bigint
language sql
stable
security definer
set search_path = lms, public
as $$
  select coalesce(lms.current_academy_id(), 1)
$$;

create or replace function lms.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function lms.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = lms, public
as $$
declare
  meta_role text := coalesce(new.raw_user_meta_data->>'role', '');
  profile_role text;
  member_role text;
begin
  -- Only provision users explicitly created for LMS. This avoids automatically
  -- granting LMS access to grade-app student accounts sharing the same Auth pool.
  if meta_role not in ('owner', 'admin', 'instructor', 'staff') then
    return new;
  end if;

  profile_role := case when meta_role = 'owner' then 'admin' else meta_role end;
  member_role := meta_role;

  insert into lms.profiles (id, email, full_name, role, current_academy_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    profile_role,
    1
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    role = excluded.role,
    current_academy_id = coalesce(lms.profiles.current_academy_id, excluded.current_academy_id),
    updated_at = now();

  insert into lms.academy_members (academy_id, user_id, role)
  values (1, new.id, member_role)
  on conflict (academy_id, user_id) do update set
    role = excluded.role,
    active = true;

  return new;
end;
$$;

drop trigger if exists on_lms_auth_user_created on auth.users;
create trigger on_lms_auth_user_created
  after insert on auth.users
  for each row execute function lms.handle_new_auth_user();

create table if not exists lms.classrooms (
  id         bigserial primary key,
  academy_id bigint not null default lms.default_academy_id()
             references lms.academies (id) on delete cascade,
  name       text not null default '강의실',
  x          double precision not null default 0,
  y          double precision not null default 0,
  width      double precision not null default 100,
  height     double precision not null default 80,
  color      text not null default '#4CAF50',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lms.instructors (
  id             bigserial primary key,
  academy_id     bigint not null default lms.default_academy_id()
                 references lms.academies (id) on delete cascade,
  name           text not null,
  email          text,
  phone          text,
  hourly_rate    numeric(12, 2),
  qualifications text,
  hire_date      date,
  status         text not null default 'active'
                 check (status in ('active', 'inactive', 'on_leave')),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists lms.students (
  id                bigserial primary key,
  academy_id        bigint not null default lms.default_academy_id()
                    references lms.academies (id) on delete cascade,
  name              text not null,
  email             text,
  phone             text,
  date_of_birth     date,
  enrollment_date   date,
  status            text not null default 'active'
                    check (status in ('active', 'inactive', 'on_leave', 'graduated', 'dropped')),
  parent_name       text,
  parent_phone      text,
  monthly_tuition   numeric(12, 2) default 0,
  payment_cycle_day integer not null default 1,
  last_payment_date date,
  notes             text,
  school_type       text,
  grade             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists lms.courses (
  id          bigserial primary key,
  academy_id  bigint not null default lms.default_academy_id()
              references lms.academies (id) on delete cascade,
  code        text,
  title       text not null,
  description text,
  credits     numeric(5, 2),
  capacity    integer,
  fee         numeric(12, 2),
  status      text not null default 'active'
              check (status in ('active', 'inactive', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (academy_id, code)
);

create table if not exists lms.lessons (
  id            bigserial primary key,
  academy_id    bigint not null default lms.default_academy_id()
                references lms.academies (id) on delete cascade,
  classroom_id  bigint references lms.classrooms (id) on delete set null,
  title         text not null,
  instructor    text,
  instructor_id bigint references lms.instructors (id) on delete set null,
  course_id     bigint references lms.courses (id) on delete set null,
  status        text not null default 'active'
                check (status in ('active', 'inactive', 'archived')),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists lms.lesson_rules (
  id             bigserial primary key,
  lesson_id      bigint not null references lms.lessons (id) on delete cascade,
  day            integer not null check (day between 0 and 6),
  start_slot     integer not null,
  end_slot       integer not null,
  start_date     date,
  end_date       date,
  interval_weeks integer not null default 1,
  active         integer not null default 1 check (active in (0, 1)),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (end_slot > start_slot)
);

create index if not exists lesson_rules_lesson_idx on lms.lesson_rules (lesson_id);

create table if not exists lms.lesson_schedules (
  id                          bigserial primary key,
  lesson_id                   bigint not null references lms.lessons (id) on delete cascade,
  rule_id                     bigint references lms.lesson_rules (id) on delete set null,
  date                        date not null,
  start_time                  time not null,
  end_time                    time not null,
  duration_minutes            integer,
  status                      text not null default 'scheduled'
                              check (status in ('scheduled', 'completed', 'cancelled', 'makeup', 'substitute', 'substituted')),
  notes                       text,
  substitute_instructor_id    bigint references lms.instructors (id) on delete set null,
  substitute_instructor_name  text,
  cancel_reason               text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (end_time > start_time)
);

create index if not exists lesson_schedules_lesson_date_idx on lms.lesson_schedules (lesson_id, date);
create index if not exists lesson_schedules_date_idx on lms.lesson_schedules (date);

create table if not exists lms.enrollments (
  id              bigserial primary key,
  academy_id      bigint not null default lms.default_academy_id()
                  references lms.academies (id) on delete cascade,
  student_id      bigint not null references lms.students (id) on delete cascade,
  lesson_id       bigint not null references lms.lessons (id) on delete cascade,
  enrolled_at     timestamptz not null default now(),
  enrollment_date date not null default current_date,
  status          text not null default 'enrolled'
                  check (status in ('enrolled', 'active', 'completed', 'dropped', 'pending')),
  grade           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (student_id, lesson_id)
);

create index if not exists enrollments_lesson_idx on lms.enrollments (lesson_id);
create index if not exists enrollments_student_idx on lms.enrollments (student_id);

create table if not exists lms.settings (
  key        text primary key,
  academy_id bigint not null default lms.default_academy_id()
             references lms.academies (id) on delete cascade,
  value      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lms.meta (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

create table if not exists lms.account_types (
  id          bigserial primary key,
  academy_id  bigint not null default lms.default_academy_id()
              references lms.academies (id) on delete cascade,
  code        text not null,
  name        text not null,
  category    text not null check (category in ('revenue', 'expense', 'asset', 'liability', 'equity')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (academy_id, code)
);

create table if not exists lms.transactions (
  id          bigserial primary key,
  academy_id  bigint not null default lms.default_academy_id()
              references lms.academies (id) on delete cascade,
  transaction_date date not null default current_date,
  description text,
  reference_type text,
  reference_id bigint,
  total_amount numeric(12, 2) not null default 0,
  status      text not null default 'completed'
              check (status in ('pending', 'completed', 'cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists lms.transaction_lines (
  id              bigserial primary key,
  transaction_id  bigint not null references lms.transactions (id) on delete cascade,
  account_type_id bigint references lms.account_types (id) on delete set null,
  entry_type      text not null check (entry_type in ('debit', 'credit')),
  amount          numeric(12, 2) not null,
  memo            text,
  created_at      timestamptz not null default now()
);

create table if not exists lms.student_payments (
  id             bigserial primary key,
  academy_id     bigint not null default lms.default_academy_id()
                 references lms.academies (id) on delete cascade,
  student_id     bigint references lms.students (id) on delete set null,
  payment_date   date not null default current_date,
  amount         numeric(12, 2) not null default 0,
  payment_method text,
  expected_date  date,
  status         text not null default 'completed'
                 check (status in ('completed', 'paid', 'pending', 'overdue', 'failed', 'cancelled')),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists student_payments_student_idx on lms.student_payments (student_id, payment_date);

create table if not exists lms.instructor_payments (
  id            bigserial primary key,
  academy_id    bigint not null default lms.default_academy_id()
                references lms.academies (id) on delete cascade,
  instructor_id bigint references lms.instructors (id) on delete set null,
  payment_date  date not null default current_date,
  amount        numeric(12, 2) not null default 0,
  work_hours    numeric(8, 2),
  period_start  date,
  period_end    date,
  status        text not null default 'completed'
                check (status in ('pending', 'completed', 'paid', 'cancelled')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists instructor_payments_instructor_idx on lms.instructor_payments (instructor_id, payment_date);

create table if not exists lms.expenses (
  id             bigserial primary key,
  academy_id     bigint not null default lms.default_academy_id()
                 references lms.academies (id) on delete cascade,
  expense_date   date not null default current_date,
  category       text not null default 'other',
  amount         numeric(12, 2) not null default 0,
  payment_method text,
  recipient      text,
  description    text,
  tax_deductible boolean not null default true,
  has_receipt    boolean not null default false,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists expenses_date_idx on lms.expenses (expense_date);

create table if not exists lms.other_income (
  id             bigserial primary key,
  academy_id     bigint not null default lms.default_academy_id()
                 references lms.academies (id) on delete cascade,
  income_date    date not null default current_date,
  category       text not null default 'other',
  amount         numeric(12, 2) not null default 0,
  payment_method text,
  payer          text,
  description    text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists other_income_date_idx on lms.other_income (income_date);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'academies', 'profiles', 'classrooms', 'instructors', 'students', 'courses',
    'lessons', 'lesson_rules', 'lesson_schedules', 'enrollments', 'settings',
    'account_types', 'transactions', 'student_payments', 'instructor_payments',
    'expenses', 'other_income'
  ]
  loop
    execute format('drop trigger if exists set_%I_updated_at on lms.%I', table_name, table_name);
    execute format(
      'create trigger set_%I_updated_at before update on lms.%I for each row execute function lms.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end $$;

alter table lms.academies enable row level security;
alter table lms.profiles enable row level security;
alter table lms.academy_members enable row level security;
alter table lms.classrooms enable row level security;
alter table lms.instructors enable row level security;
alter table lms.students enable row level security;
alter table lms.courses enable row level security;
alter table lms.lessons enable row level security;
alter table lms.lesson_rules enable row level security;
alter table lms.lesson_schedules enable row level security;
alter table lms.enrollments enable row level security;
alter table lms.settings enable row level security;
alter table lms.meta enable row level security;
alter table lms.account_types enable row level security;
alter table lms.transactions enable row level security;
alter table lms.transaction_lines enable row level security;
alter table lms.student_payments enable row level security;
alter table lms.instructor_payments enable row level security;
alter table lms.expenses enable row level security;
alter table lms.other_income enable row level security;

drop policy if exists academies_member_select on lms.academies;
create policy academies_member_select on lms.academies
  for select to authenticated
  using (lms.belongs_to_current_academy(id));

drop policy if exists profiles_self_select on lms.profiles;
create policy profiles_self_select on lms.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists profiles_self_update on lms.profiles;
create policy profiles_self_update on lms.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists academy_members_self_select on lms.academy_members;
create policy academy_members_self_select on lms.academy_members
  for select to authenticated
  using (user_id = auth.uid());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'classrooms', 'instructors', 'students', 'courses', 'lessons', 'enrollments',
    'settings', 'account_types', 'transactions', 'student_payments',
    'instructor_payments', 'expenses', 'other_income'
  ]
  loop
    execute format('drop policy if exists %I on lms.%I', table_name || '_academy_all', table_name);
    execute format(
      'create policy %I on lms.%I for all to authenticated using (lms.belongs_to_current_academy(academy_id)) with check (lms.belongs_to_current_academy(academy_id))',
      table_name || '_academy_all',
      table_name
    );
  end loop;
end $$;

drop policy if exists lesson_rules_academy_all on lms.lesson_rules;
create policy lesson_rules_academy_all on lms.lesson_rules
  for all to authenticated
  using (
    exists (
      select 1 from lms.lessons l
      where l.id = lesson_rules.lesson_id
        and lms.belongs_to_current_academy(l.academy_id)
    )
  )
  with check (
    exists (
      select 1 from lms.lessons l
      where l.id = lesson_rules.lesson_id
        and lms.belongs_to_current_academy(l.academy_id)
    )
  );

drop policy if exists lesson_schedules_academy_all on lms.lesson_schedules;
create policy lesson_schedules_academy_all on lms.lesson_schedules
  for all to authenticated
  using (
    exists (
      select 1 from lms.lessons l
      where l.id = lesson_schedules.lesson_id
        and lms.belongs_to_current_academy(l.academy_id)
    )
  )
  with check (
    exists (
      select 1 from lms.lessons l
      where l.id = lesson_schedules.lesson_id
        and lms.belongs_to_current_academy(l.academy_id)
    )
  );

drop policy if exists transaction_lines_academy_all on lms.transaction_lines;
create policy transaction_lines_academy_all on lms.transaction_lines
  for all to authenticated
  using (
    exists (
      select 1 from lms.transactions t
      where t.id = transaction_lines.transaction_id
        and lms.belongs_to_current_academy(t.academy_id)
    )
  )
  with check (
    exists (
      select 1 from lms.transactions t
      where t.id = transaction_lines.transaction_id
        and lms.belongs_to_current_academy(t.academy_id)
    )
  );

drop policy if exists meta_authenticated_all on lms.meta;
create policy meta_authenticated_all on lms.meta
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

grant usage on schema lms to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema lms to authenticated;
grant usage, select on all sequences in schema lms to authenticated;
grant all on all tables in schema lms to service_role;
grant usage, select on all sequences in schema lms to service_role;

alter default privileges in schema lms grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema lms grant usage, select on sequences to authenticated;
alter default privileges in schema lms grant all on tables to service_role;
alter default privileges in schema lms grant usage, select on sequences to service_role;

alter role authenticator set pgrst.db_schemas = 'public, graphql_public, core, learning, lms';
notify pgrst, 'reload config';
