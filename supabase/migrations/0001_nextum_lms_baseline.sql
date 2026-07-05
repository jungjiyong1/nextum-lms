-- Nextum LMS clean baseline.
-- LMS owns the shared data model used by the LMS app and, later, grade-app.

create extension if not exists pgcrypto;

create schema if not exists core;
create schema if not exists content;
create schema if not exists learning;
create schema if not exists lms;
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

-- ---------------------------------------------------------------------------
-- Canonical identity / roster

create table core.academies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  status     text not null default 'active'
             check (status in ('active', 'inactive', 'archived')),
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table core.people (
  id                 uuid primary key default gen_random_uuid(),
  primary_academy_id  uuid references core.academies (id) on delete set null,
  full_name           text not null,
  display_name        text,
  email               text,
  phone               text,
  parent_name         text,
  parent_phone        text,
  date_of_birth       date,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table core.user_accounts (
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

create unique index core_user_accounts_login_id_key
  on core.user_accounts (lower(login_id))
  where login_id is not null;

create table core.students (
  id                 uuid primary key default gen_random_uuid(),
  academy_id         uuid not null references core.academies (id) on delete cascade,
  person_id          uuid not null references core.people (id) on delete cascade,
  status             text not null default 'active'
                     check (status in ('active', 'inactive', 'on_leave', 'graduated', 'dropped')),
  school_type        text check (school_type in ('elementary', 'middle', 'high') or school_type is null),
  grade              text,
  enrollment_date    date,
  notes              text,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (academy_id, person_id)
);

create table core.staff_members (
  id            uuid primary key default gen_random_uuid(),
  academy_id    uuid not null references core.academies (id) on delete cascade,
  person_id     uuid not null references core.people (id) on delete cascade,
  role          text not null default 'staff'
                check (role in ('owner', 'admin', 'teacher', 'instructor', 'staff')),
  status        text not null default 'active'
                check (status in ('active', 'inactive', 'on_leave')),
  hourly_rate   numeric(12, 2),
  hire_date     date,
  qualifications text,
  notes         text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (academy_id, person_id, role)
);

create table core.academy_members (
  id              uuid primary key default gen_random_uuid(),
  academy_id      uuid not null references core.academies (id) on delete cascade,
  person_id       uuid not null references core.people (id) on delete cascade,
  user_account_id uuid references core.user_accounts (id) on delete cascade,
  role            text not null
                  check (role in ('owner', 'admin', 'teacher', 'instructor', 'staff', 'student', 'guardian')),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (academy_id, person_id, role)
);

create table core.user_security_settings (
  user_account_id uuid primary key references core.user_accounts (id) on delete cascade,
  pin_hash        text,
  idle_timeout    integer not null default 10 check (idle_timeout between 1 and 240),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table core.account_invitations (
  id                    uuid primary key default gen_random_uuid(),
  academy_id            uuid not null references core.academies (id) on delete cascade,
  person_id             uuid references core.people (id) on delete cascade,
  student_id            uuid references core.students (id) on delete cascade,
  staff_member_id       uuid references core.staff_members (id) on delete cascade,
  role                  text not null
                        check (role in ('student', 'guardian', 'teacher', 'instructor', 'staff', 'admin')),
  invite_code_hash      text not null unique,
  login_hint            text,
  expires_at            timestamptz not null default (now() + interval '14 days'),
  accepted_at           timestamptz,
  accepted_auth_user_id uuid references auth.users (id) on delete set null,
  created_by            uuid references core.people (id) on delete set null,
  created_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Content contract consumed by grade-app

create table content.books (
  id               uuid primary key default gen_random_uuid(),
  academy_id       uuid references core.academies (id) on delete cascade,
  book_key         text not null unique,
  title            text not null,
  subject          text,
  grade            text,
  schema_version   integer not null default 1,
  pipeline_version text,
  imported_at      timestamptz not null default now(),
  metadata         jsonb not null default '{}'::jsonb
);

create table content.units (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references content.books (id) on delete cascade,
  unit_key   text not null,
  part_name  text not null default '',
  name       text not null,
  page_start integer,
  page_end   integer,
  sort_order integer not null default 0,
  metadata   jsonb not null default '{}'::jsonb,
  unique (book_id, unit_key)
);

create table content.concepts (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references content.books (id) on delete cascade,
  unit_id    uuid references content.units (id) on delete cascade,
  name       text not null,
  name_raw   text,
  sort_order integer not null default 0,
  detail     jsonb,
  unique (book_id, unit_id, name)
);

create table content.problem_types (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references content.books (id) on delete cascade,
  unit_id    uuid references content.units (id) on delete cascade,
  concept_id uuid references content.concepts (id) on delete set null,
  name       text not null,
  name_raw   text,
  sort_order integer not null default 0,
  unique (book_id, name)
);

create or replace function content.problem_public_payload(answer jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_strip_nulls(
    jsonb_build_object(
      'type', answer->>'type',
      'choice_count',
        case
          when answer ? 'choice_count' then nullif(answer->>'choice_count', '')::int
          when jsonb_typeof(answer->'choices') = 'array' then jsonb_array_length(answer->'choices')
          else null
        end,
      'choices',
        case when jsonb_typeof(answer->'choices') = 'array' then answer->'choices' end,
      'options',
        case
          when jsonb_typeof(answer->'choices') = 'array' then answer->'choices'
          when jsonb_typeof(answer->'distractors') = 'array' then answer->'distractors'
          else null
        end,
      'multiple',
        case when answer ? 'multiple' then (answer->>'multiple')::boolean else null end,
      'self_grade',
        (answer->>'type' = 'text')
        or (jsonb_typeof(answer->'subs') = 'array' and jsonb_array_length(answer->'subs') > 0),
      'subs',
        case
          when jsonb_typeof(answer->'subs') = 'array' then (
            select jsonb_agg(
              jsonb_strip_nulls(
                jsonb_build_object(
                  'label', sub->>'label',
                  'type', sub->>'type'
                )
              )
            )
            from jsonb_array_elements(answer->'subs') as s(sub)
          )
          else null
        end
    )
  )
$$;

create table content.problems (
  id                 text primary key,
  book_id            uuid not null references content.books (id) on delete cascade,
  unit_id            uuid not null references content.units (id) on delete cascade,
  concept_id         uuid references content.concepts (id) on delete set null,
  problem_type_id    uuid references content.problem_types (id) on delete set null,
  page_printed       integer not null,
  number             text not null,
  image_path         text,
  answer             jsonb not null,
  answer_key         jsonb not null,
  public_payload     jsonb not null,
  position_in_type   integer,
  is_example         boolean not null default false,
  difficulty_hint    text,
  verified           boolean not null default true,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create or replace function content.set_problem_answer_contract()
returns trigger
language plpgsql
as $$
begin
  if new.answer_key is null then
    new.answer_key := new.answer;
  end if;
  if new.public_payload is null then
    new.public_payload := content.problem_public_payload(new.answer);
  end if;
  return new;
end;
$$;

create trigger set_problem_answer_contract
  before insert or update on content.problems
  for each row execute function content.set_problem_answer_contract();

create table content.assets (
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid references content.books (id) on delete cascade,
  problem_id   text references content.problems (id) on delete cascade,
  kind         text not null default 'problem_image',
  storage_path text not null,
  media_type   text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Canonical classes and book assignments

create table core.classes (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references core.academies (id) on delete cascade,
  name        text not null,
  grade       text,
  active      boolean not null default true,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (academy_id, name)
);

create table core.class_students (
  class_id        uuid not null references core.classes (id) on delete cascade,
  student_id      uuid not null references core.students (id) on delete cascade,
  status          text not null default 'active'
                  check (status in ('active', 'pending', 'on_leave', 'completed', 'dropped')),
  joined_at       timestamptz not null default now(),
  ended_at        timestamptz,
  primary_class   boolean not null default false,
  metadata        jsonb not null default '{}'::jsonb,
  primary key (class_id, student_id)
);

create table core.class_books (
  class_id    uuid not null references core.classes (id) on delete cascade,
  book_id     uuid not null references content.books (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  active      boolean not null default true,
  metadata    jsonb not null default '{}'::jsonb,
  primary key (class_id, book_id)
);

-- ---------------------------------------------------------------------------
-- LMS operations

create table lms.courses (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references core.academies (id) on delete cascade,
  code        text,
  title       text not null,
  description text,
  default_fee numeric(12, 2),
  status      text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (academy_id, code)
);

create table lms.classrooms (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references core.academies (id) on delete cascade,
  name        text not null,
  capacity    integer,
  color       text,
  position    jsonb not null default '{}'::jsonb,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (academy_id, name)
);

create table lms.class_profiles (
  class_id                    uuid primary key references core.classes (id) on delete cascade,
  academy_id                  uuid not null references core.academies (id) on delete cascade,
  course_id                   uuid references lms.courses (id) on delete set null,
  default_instructor_staff_id uuid references core.staff_members (id) on delete set null,
  default_classroom_id        uuid references lms.classrooms (id) on delete set null,
  capacity                    integer,
  color                       text,
  status                      text not null default 'active'
                              check (status in ('active', 'inactive', 'archived')),
  notes                       text,
  metadata                    jsonb not null default '{}'::jsonb,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (capacity is null or capacity >= 0)
);

create table lms.class_schedule_rules (
  id                           uuid primary key default gen_random_uuid(),
  academy_id                   uuid not null references core.academies (id) on delete cascade,
  class_id                     uuid not null references core.classes (id) on delete cascade,
  day_of_week                  integer not null check (day_of_week between 0 and 6),
  start_time                   time not null,
  end_time                     time not null,
  start_date                   date not null,
  end_date                     date,
  interval_weeks               integer not null default 1 check (interval_weeks > 0),
  classroom_id                 uuid references lms.classrooms (id) on delete set null,
  instructor_staff_id          uuid references core.staff_members (id) on delete set null,
  active                       boolean not null default true,
  metadata                     jsonb not null default '{}'::jsonb,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  check (end_time > start_time)
);

create table lms.lesson_occurrences (
  id                    uuid primary key default gen_random_uuid(),
  academy_id            uuid not null references core.academies (id) on delete cascade,
  class_id              uuid not null references core.classes (id) on delete cascade,
  rule_id               uuid references lms.class_schedule_rules (id) on delete set null,
  occurrence_date       date not null,
  start_time            time not null,
  end_time              time not null,
  duration_minutes      integer generated always as (
    (extract(epoch from (end_time - start_time)) / 60)::integer
  ) stored,
  status                text not null default 'scheduled'
                        check (status in ('scheduled', 'completed', 'cancelled', 'makeup', 'substitute')),
  classroom_id          uuid references lms.classrooms (id) on delete set null,
  instructor_staff_id   uuid references core.staff_members (id) on delete set null,
  substitute_staff_id   uuid references core.staff_members (id) on delete set null,
  cancel_reason         text,
  override_scope        text check (override_scope in ('single', 'future', 'all') or override_scope is null),
  notes                 text,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (end_time > start_time),
  unique (class_id, occurrence_date, start_time, coalesce(rule_id, '00000000-0000-0000-0000-000000000000'::uuid))
);

create table lms.attendance_records (
  id                  uuid primary key default gen_random_uuid(),
  academy_id          uuid not null references core.academies (id) on delete cascade,
  occurrence_id       uuid not null references lms.lesson_occurrences (id) on delete cascade,
  student_id          uuid not null references core.students (id) on delete cascade,
  status              text not null default 'present'
                      check (status in ('present', 'late', 'absent', 'excused', 'makeup')),
  attended_minutes    integer,
  billable_minutes    integer,
  recorded_by         uuid references core.people (id) on delete set null,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (occurrence_id, student_id),
  check (attended_minutes is null or attended_minutes >= 0),
  check (billable_minutes is null or billable_minutes >= 0)
);

create table lms.student_billing_contracts (
  id                uuid primary key default gen_random_uuid(),
  academy_id        uuid not null references core.academies (id) on delete cascade,
  student_id        uuid not null references core.students (id) on delete cascade,
  billing_mode      text not null default 'monthly_plus_classes'
                    check (billing_mode in ('monthly_plus_classes', 'usage_based', 'manual')),
  base_monthly_fee  numeric(12, 2) not null default 0,
  hourly_rate       numeric(12, 2),
  cycle_day         integer not null default 1 check (cycle_day between 1 and 28),
  effective_from    date not null default current_date,
  effective_to      date,
  status            text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  notes             text,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table lms.billing_class_rules (
  id             uuid primary key default gen_random_uuid(),
  academy_id     uuid not null references core.academies (id) on delete cascade,
  contract_id    uuid not null references lms.student_billing_contracts (id) on delete cascade,
  class_id       uuid not null references core.classes (id) on delete cascade,
  rule_type      text not null default 'included'
                 check (rule_type in ('included', 'extra_flat', 'discount', 'usage_based')),
  amount         numeric(12, 2) not null default 0,
  effective_from date not null default current_date,
  effective_to   date,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create table lms.invoices (
  id              uuid primary key default gen_random_uuid(),
  academy_id      uuid not null references core.academies (id) on delete cascade,
  student_id      uuid not null references core.students (id) on delete cascade,
  service_month   text not null check (service_month ~ '^[0-9]{4}-[0-9]{2}$'),
  issue_date      date not null default current_date,
  due_date        date,
  subtotal_amount numeric(12, 2) not null default 0,
  discount_amount numeric(12, 2) not null default 0,
  total_amount    numeric(12, 2) not null default 0,
  paid_amount     numeric(12, 2) not null default 0,
  status          text not null default 'draft'
                  check (status in ('draft', 'issued', 'partial', 'paid', 'overdue', 'void')),
  notes           text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (student_id, service_month)
);

create table lms.invoice_lines (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references lms.invoices (id) on delete cascade,
  line_type      text not null
                 check (line_type in ('base_fee', 'class_extra', 'usage', 'discount', 'manual')),
  class_id       uuid references core.classes (id) on delete set null,
  occurrence_id  uuid references lms.lesson_occurrences (id) on delete set null,
  description    text not null,
  quantity       numeric(10, 2) not null default 1,
  unit_amount    numeric(12, 2) not null default 0,
  amount         numeric(12, 2) not null default 0,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create table lms.payments (
  id             uuid primary key default gen_random_uuid(),
  academy_id     uuid not null references core.academies (id) on delete cascade,
  invoice_id     uuid references lms.invoices (id) on delete set null,
  student_id     uuid not null references core.students (id) on delete cascade,
  payment_date   date not null default current_date,
  amount         numeric(12, 2) not null check (amount >= 0),
  payment_method text,
  status         text not null default 'completed'
                 check (status in ('pending', 'completed', 'failed', 'cancelled', 'refunded')),
  notes          text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table lms.expenses (
  id             uuid primary key default gen_random_uuid(),
  academy_id     uuid not null references core.academies (id) on delete cascade,
  expense_date   date not null default current_date,
  category       text not null,
  amount         numeric(12, 2) not null check (amount >= 0),
  payment_method text,
  recipient      text,
  description    text,
  tax_deductible boolean not null default true,
  has_receipt    boolean not null default false,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table lms.instructor_payments (
  id               uuid primary key default gen_random_uuid(),
  academy_id       uuid not null references core.academies (id) on delete cascade,
  instructor_id    uuid references core.staff_members (id) on delete set null,
  recipient_name   text,
  service_month    text not null check (service_month ~ '^[0-9]{4}-[0-9]{2}$'),
  payment_date     date not null default current_date,
  gross_amount     numeric(12, 2) not null default 0,
  withholding_type text not null default 'none'
                   check (withholding_type in ('none', 'freelance_3.3', 'custom')),
  withholding_rate numeric(8, 4) not null default 0,
  withholding_tax  numeric(12, 2) not null default 0,
  local_tax        numeric(12, 2) not null default 0,
  net_amount       numeric(12, 2) not null default 0,
  hours_worked     numeric(10, 2),
  hourly_rate      numeric(12, 2),
  payment_method   text,
  status           text not null default 'paid'
                   check (status in ('pending', 'paid', 'cancelled')),
  notes            text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table lms.settings (
  academy_id  uuid not null references core.academies (id) on delete cascade,
  key         text not null,
  value       text,
  metadata    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (academy_id, key)
);

-- ---------------------------------------------------------------------------
-- Learning, AI, event log

create table learning.sessions (
  id              uuid primary key default gen_random_uuid(),
  academy_id      uuid not null references core.academies (id) on delete cascade,
  student_id      uuid references auth.users (id) on delete set null,
  core_student_id uuid not null references core.students (id) on delete cascade,
  book_id         uuid not null references content.books (id) on delete cascade,
  scope           jsonb not null,
  scope_label     text not null,
  context         text not null default 'homework'
                  check (context in ('homework', 'free', 'retry', 'drill', 'diagnostic')),
  started_at      timestamptz not null default now(),
  submitted_at    timestamptz,
  metadata        jsonb not null default '{}'::jsonb
);

create table learning.attempts (
  id              bigint generated always as identity primary key,
  academy_id      uuid not null references core.academies (id) on delete cascade,
  session_id      uuid not null references learning.sessions (id) on delete cascade,
  student_id      uuid references auth.users (id) on delete set null,
  core_student_id uuid not null references core.students (id) on delete cascade,
  problem_id      text not null references content.problems (id) on delete cascade,
  sub_label       text,
  answer_given    text,
  correct         boolean not null,
  unsure          boolean not null default false,
  attempt_no      integer not null,
  duration_ms     integer,
  created_at      timestamptz not null default now(),
  schema_v        integer not null default 1,
  metadata        jsonb not null default '{}'::jsonb
);

create table learning.wrong_notes (
  academy_id      uuid not null references core.academies (id) on delete cascade,
  core_student_id uuid not null references core.students (id) on delete cascade,
  problem_id      text not null references content.problems (id) on delete cascade,
  status          text not null default 'open' check (status in ('open', 'resolved')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  primary key (core_student_id, problem_id)
);

create table learning.reports (
  id              uuid primary key default gen_random_uuid(),
  academy_id      uuid not null references core.academies (id) on delete cascade,
  core_student_id uuid not null references core.students (id) on delete cascade,
  problem_id      text not null references content.problems (id) on delete cascade,
  reason          text not null,
  status          text not null default 'open' check (status in ('open', 'fixed', 'rejected')),
  created_at      timestamptz not null default now()
);

create table ai.conversations (
  id              uuid primary key default gen_random_uuid(),
  academy_id      uuid not null references core.academies (id) on delete cascade,
  student_id      uuid not null references core.students (id) on delete cascade,
  session_id      uuid references learning.sessions (id) on delete set null,
  problem_id      text references content.problems (id) on delete set null,
  source_app      text not null default 'grade_app',
  provider        text,
  provider_thread_id text,
  title           text,
  status          text not null default 'open' check (status in ('open', 'archived')),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table ai.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai.conversations (id) on delete cascade,
  role            text not null check (role in ('system', 'user', 'assistant', 'tool')),
  content         text not null,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create table data.events (
  id            uuid primary key default gen_random_uuid(),
  academy_id    uuid references core.academies (id) on delete set null,
  student_id    uuid references core.students (id) on delete set null,
  class_id      uuid references core.classes (id) on delete set null,
  source_app    text not null,
  event_type    text not null,
  entity_schema text,
  entity_table  text,
  entity_id     text,
  occurred_at   timestamptz not null default now(),
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create table audit.admin_actions (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid references core.academies (id) on delete set null,
  actor_id    uuid references core.people (id) on delete set null,
  action      text not null,
  target      text,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes

create index core_people_academy_idx on core.people (primary_academy_id);
create index core_students_academy_idx on core.students (academy_id, status);
create index core_students_person_idx on core.students (person_id);
create index core_staff_academy_idx on core.staff_members (academy_id, status);
create index core_members_account_idx on core.academy_members (user_account_id);
create index core_members_person_idx on core.academy_members (person_id);
create index core_classes_academy_idx on core.classes (academy_id, active);
create index core_class_students_student_idx on core.class_students (student_id, status);
create index core_class_books_book_idx on core.class_books (book_id);

create index content_units_book_idx on content.units (book_id, sort_order);
create index content_concepts_book_idx on content.concepts (book_id, unit_id);
create index content_problem_types_book_idx on content.problem_types (book_id, unit_id);
create index content_problems_book_idx on content.problems (book_id, unit_id);
create index content_problems_type_idx on content.problems (problem_type_id) where problem_type_id is not null;
create index content_assets_problem_idx on content.assets (problem_id);

create index lms_class_profiles_academy_idx on lms.class_profiles (academy_id, status);
create index lms_rules_class_idx on lms.class_schedule_rules (class_id, active);
create index lms_occurrences_class_date_idx on lms.lesson_occurrences (class_id, occurrence_date);
create index lms_occurrences_academy_date_idx on lms.lesson_occurrences (academy_id, occurrence_date);
create index lms_attendance_student_idx on lms.attendance_records (student_id, created_at desc);
create index lms_contracts_student_idx on lms.student_billing_contracts (student_id, status);
create index lms_invoices_student_month_idx on lms.invoices (student_id, service_month);
create index lms_payments_student_date_idx on lms.payments (student_id, payment_date desc);
create index lms_payroll_instructor_month_idx on lms.instructor_payments (instructor_id, service_month);

create index learning_sessions_student_idx on learning.sessions (core_student_id, started_at desc);
create index learning_attempts_student_problem_idx on learning.attempts (core_student_id, problem_id);
create index learning_attempts_session_idx on learning.attempts (session_id);
create index ai_conversations_student_idx on ai.conversations (student_id, created_at desc);
create index ai_messages_conversation_idx on ai.messages (conversation_id, created_at);
create index data_events_student_time_idx on data.events (student_id, occurred_at desc);
create index data_events_class_time_idx on data.events (class_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Auth helpers used by RLS

create or replace function core.current_account_id()
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
    where am.academy_id = check_academy_id
      and am.active
      and am.role = any(allowed_roles)
      and (
        am.person_id = core.current_person_id()
        or am.user_account_id = core.current_account_id()
      )
  )
$$;

create or replace function core.current_student_id(check_academy_id uuid)
returns uuid
language sql
stable
security definer
set search_path = core, public
as $$
  select s.id
  from core.students s
  where s.academy_id = check_academy_id
    and s.status = 'active'
    and s.person_id = core.current_person_id()
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
    where s.id = check_student_id
      and (
        s.id = core.current_student_id(s.academy_id)
        or core.has_academy_role(s.academy_id, array['owner','admin','staff','teacher','instructor'])
      )
  )
$$;

create or replace function core.can_access_book(check_book_id uuid)
returns boolean
language sql
stable
security definer
set search_path = core, content, public
as $$
  select exists (
    select 1
    from content.books b
    where b.id = check_book_id
      and (
        (b.academy_id is not null and core.has_academy_role(b.academy_id, array['owner','admin','staff','teacher','instructor']))
        or exists (
          select 1
          from core.class_books cb
          join core.class_students cs on cs.class_id = cb.class_id and cs.status = 'active'
          join core.classes c on c.id = cb.class_id and c.active
          where cb.book_id = b.id
            and cb.active
            and (
              cs.student_id = core.current_student_id(c.academy_id)
              or core.has_academy_role(c.academy_id, array['owner','admin','staff','teacher','instructor'])
            )
        )
      )
  )
$$;

-- ---------------------------------------------------------------------------
-- Reporting views

create view reporting.v_student_type_weakness
with (security_invoker = true)
as
with first_attempts as (
  select
    a.academy_id,
    a.core_student_id,
    a.problem_id,
    bool_and(a.correct) as correct,
    bool_or(a.unsure) as unsure,
    min(a.created_at) as first_attempted_at
  from learning.attempts a
  where a.attempt_no = 1
  group by a.academy_id, a.core_student_id, a.problem_id
),
scored as (
  select
    fa.academy_id,
    fa.core_student_id,
    p.book_id,
    p.unit_id,
    coalesce(p.problem_type_id, '00000000-0000-0000-0000-000000000000'::uuid) as problem_type_id,
    fa.correct,
    fa.unsure,
    fa.first_attempted_at
  from first_attempts fa
  join content.problems p on p.id = fa.problem_id
)
select
  s.academy_id,
  s.core_student_id as student_id,
  st.person_id,
  pe.full_name as student_name,
  cs.class_id,
  s.book_id,
  s.problem_type_id,
  coalesce(pt.name, u.name, 'No type') as type_name,
  count(*) as sample_count,
  count(*) filter (where s.correct) as correct_count,
  round(
    100.0 * avg(
      case
        when s.correct and s.unsure then 0.5
        when s.correct then 1.0
        else 0.0
      end
    ),
    1
  ) as score,
  case
    when count(*) < 2 then 'insufficient'
    when avg(case when s.correct and s.unsure then 0.5 when s.correct then 1.0 else 0.0 end) < 0.5 then 'weak'
    when avg(case when s.correct and s.unsure then 0.5 when s.correct then 1.0 else 0.0 end) < 0.75 then 'watch'
    else 'ok'
  end as status,
  max(s.first_attempted_at) as last_attempted_at
from scored s
join core.students st on st.id = s.core_student_id
join core.people pe on pe.id = st.person_id
left join core.class_students cs on cs.student_id = st.id and cs.status = 'active'
left join content.problem_types pt on pt.id = nullif(s.problem_type_id, '00000000-0000-0000-0000-000000000000'::uuid)
left join content.units u on u.id = s.unit_id
group by s.academy_id, s.core_student_id, st.person_id, pe.full_name, cs.class_id, s.book_id, s.problem_type_id, pt.name, u.name;

create view reporting.v_class_learning_summary
with (security_invoker = true)
as
select
  c.academy_id,
  c.id as class_id,
  c.name as class_name,
  count(distinct cs.student_id) filter (where cs.status = 'active') as active_students,
  count(distinct w.student_id) filter (where w.status in ('weak', 'watch')) as students_with_risk,
  count(*) filter (where w.status = 'weak') as weak_type_count,
  round(avg(w.score), 1) as avg_type_score,
  max(w.last_attempted_at) as last_learning_at
from core.classes c
left join core.class_students cs on cs.class_id = c.id
left join reporting.v_student_type_weakness w on w.class_id = c.id
group by c.academy_id, c.id, c.name;

-- ---------------------------------------------------------------------------
-- Triggers

create trigger set_academies_updated_at before update on core.academies for each row execute function core.set_updated_at();
create trigger set_people_updated_at before update on core.people for each row execute function core.set_updated_at();
create trigger set_user_accounts_updated_at before update on core.user_accounts for each row execute function core.set_updated_at();
create trigger set_students_updated_at before update on core.students for each row execute function core.set_updated_at();
create trigger set_staff_updated_at before update on core.staff_members for each row execute function core.set_updated_at();
create trigger set_members_updated_at before update on core.academy_members for each row execute function core.set_updated_at();
create trigger set_security_updated_at before update on core.user_security_settings for each row execute function core.set_updated_at();
create trigger set_classes_updated_at before update on core.classes for each row execute function core.set_updated_at();
create trigger set_content_problems_updated_at before update on content.problems for each row execute function core.set_updated_at();
create trigger set_courses_updated_at before update on lms.courses for each row execute function core.set_updated_at();
create trigger set_classrooms_updated_at before update on lms.classrooms for each row execute function core.set_updated_at();
create trigger set_class_profiles_updated_at before update on lms.class_profiles for each row execute function core.set_updated_at();
create trigger set_rules_updated_at before update on lms.class_schedule_rules for each row execute function core.set_updated_at();
create trigger set_occurrences_updated_at before update on lms.lesson_occurrences for each row execute function core.set_updated_at();
create trigger set_attendance_updated_at before update on lms.attendance_records for each row execute function core.set_updated_at();
create trigger set_contracts_updated_at before update on lms.student_billing_contracts for each row execute function core.set_updated_at();
create trigger set_invoices_updated_at before update on lms.invoices for each row execute function core.set_updated_at();
create trigger set_payments_updated_at before update on lms.payments for each row execute function core.set_updated_at();
create trigger set_expenses_updated_at before update on lms.expenses for each row execute function core.set_updated_at();
create trigger set_instructor_payments_updated_at before update on lms.instructor_payments for each row execute function core.set_updated_at();
create trigger set_ai_conversations_updated_at before update on ai.conversations for each row execute function core.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS

alter table core.academies enable row level security;
alter table core.people enable row level security;
alter table core.user_accounts enable row level security;
alter table core.students enable row level security;
alter table core.staff_members enable row level security;
alter table core.academy_members enable row level security;
alter table core.user_security_settings enable row level security;
alter table core.account_invitations enable row level security;
alter table core.classes enable row level security;
alter table core.class_students enable row level security;
alter table core.class_books enable row level security;

alter table content.books enable row level security;
alter table content.units enable row level security;
alter table content.concepts enable row level security;
alter table content.problem_types enable row level security;
alter table content.problems enable row level security;
alter table content.assets enable row level security;

alter table lms.courses enable row level security;
alter table lms.classrooms enable row level security;
alter table lms.class_profiles enable row level security;
alter table lms.class_schedule_rules enable row level security;
alter table lms.lesson_occurrences enable row level security;
alter table lms.attendance_records enable row level security;
alter table lms.student_billing_contracts enable row level security;
alter table lms.billing_class_rules enable row level security;
alter table lms.invoices enable row level security;
alter table lms.invoice_lines enable row level security;
alter table lms.payments enable row level security;
alter table lms.expenses enable row level security;
alter table lms.instructor_payments enable row level security;
alter table lms.settings enable row level security;

alter table learning.sessions enable row level security;
alter table learning.attempts enable row level security;
alter table learning.wrong_notes enable row level security;
alter table learning.reports enable row level security;
alter table ai.conversations enable row level security;
alter table ai.messages enable row level security;
alter table data.events enable row level security;
alter table audit.admin_actions enable row level security;

create policy academies_staff_select on core.academies for select to authenticated
  using (core.has_academy_role(id, array['owner','admin','staff','teacher','instructor']));

create policy people_access on core.people for select to authenticated
  using (
    id = core.current_person_id()
    or core.has_academy_role(primary_academy_id, array['owner','admin','staff','teacher','instructor'])
  );

create policy people_staff_write on core.people for all to authenticated
  using (core.has_academy_role(primary_academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(primary_academy_id, array['owner','admin','staff']));

create policy user_accounts_self_select on core.user_accounts for select to authenticated
  using (auth_user_id = (select auth.uid()));

create policy user_accounts_staff_select on core.user_accounts for select to authenticated
  using (
    exists (
      select 1
      from core.academy_members am
      where am.person_id = user_accounts.person_id
        and core.has_academy_role(am.academy_id, array['owner','admin','staff'])
    )
  );

create policy students_access on core.students for select to authenticated
  using (core.can_access_student(id));

create policy students_staff_write on core.students for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));

create policy staff_access on core.staff_members for select to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor']));

create policy staff_admin_write on core.staff_members for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin']))
  with check (core.has_academy_role(academy_id, array['owner','admin']));

create policy members_access on core.academy_members for select to authenticated
  using (
    person_id = core.current_person_id()
    or core.has_academy_role(academy_id, array['owner','admin','staff'])
  );

create policy security_self on core.user_security_settings for all to authenticated
  using (user_account_id = core.current_account_id())
  with check (user_account_id = core.current_account_id());

create policy invitations_staff on core.account_invitations for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));

create policy classes_access on core.classes for select to authenticated
  using (
    core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor'])
    or exists (
      select 1 from core.class_students cs
      where cs.class_id = classes.id
        and cs.student_id = core.current_student_id(classes.academy_id)
        and cs.status = 'active'
    )
  );

create policy classes_staff_write on core.classes for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));

create policy class_students_access on core.class_students for select to authenticated
  using (
    exists (
      select 1 from core.classes c
      where c.id = class_students.class_id
        and (
          core.has_academy_role(c.academy_id, array['owner','admin','staff','teacher','instructor'])
          or class_students.student_id = core.current_student_id(c.academy_id)
        )
    )
  );

create policy class_students_staff_write on core.class_students for all to authenticated
  using (
    exists (select 1 from core.classes c where c.id = class_students.class_id and core.has_academy_role(c.academy_id, array['owner','admin','staff']))
  )
  with check (
    exists (select 1 from core.classes c where c.id = class_students.class_id and core.has_academy_role(c.academy_id, array['owner','admin','staff']))
  );

create policy class_books_access on core.class_books for select to authenticated
  using (
    exists (
      select 1 from core.classes c
      where c.id = class_books.class_id
        and (
          core.has_academy_role(c.academy_id, array['owner','admin','staff','teacher','instructor'])
          or exists (
            select 1 from core.class_students cs
            where cs.class_id = c.id
              and cs.student_id = core.current_student_id(c.academy_id)
              and cs.status = 'active'
          )
        )
    )
  );

create policy class_books_staff_write on core.class_books for all to authenticated
  using (
    exists (select 1 from core.classes c where c.id = class_books.class_id and core.has_academy_role(c.academy_id, array['owner','admin','staff','teacher','instructor']))
  )
  with check (
    exists (select 1 from core.classes c where c.id = class_books.class_id and core.has_academy_role(c.academy_id, array['owner','admin','staff','teacher','instructor']))
  );

create policy content_books_select on content.books for select to authenticated
  using (core.can_access_book(id));
create policy content_units_select on content.units for select to authenticated
  using (core.can_access_book(book_id));
create policy content_concepts_select on content.concepts for select to authenticated
  using (core.can_access_book(book_id));
create policy content_types_select on content.problem_types for select to authenticated
  using (core.can_access_book(book_id));
create policy content_problems_select on content.problems for select to authenticated
  using (core.can_access_book(book_id));
create policy content_assets_select on content.assets for select to authenticated
  using (book_id is not null and core.can_access_book(book_id));

create policy content_staff_write_books on content.books for all to authenticated
  using (academy_id is not null and core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (academy_id is not null and core.has_academy_role(academy_id, array['owner','admin','staff']));

create policy lms_courses_staff on lms.courses for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_classrooms_staff on lms.classrooms for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_class_profiles_staff on lms.class_profiles for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_rules_staff on lms.class_schedule_rules for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor']));
create policy lms_occurrences_staff on lms.lesson_occurrences for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor']));
create policy lms_attendance_staff on lms.attendance_records for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor']));
create policy lms_billing_staff on lms.student_billing_contracts for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_billing_rules_staff on lms.billing_class_rules for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_invoices_staff on lms.invoices for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_invoice_lines_staff on lms.invoice_lines for all to authenticated
  using (
    exists (select 1 from lms.invoices i where i.id = invoice_lines.invoice_id and core.has_academy_role(i.academy_id, array['owner','admin','staff']))
  )
  with check (
    exists (select 1 from lms.invoices i where i.id = invoice_lines.invoice_id and core.has_academy_role(i.academy_id, array['owner','admin','staff']))
  );
create policy lms_payments_staff on lms.payments for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_expenses_staff on lms.expenses for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_payroll_staff on lms.instructor_payments for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_settings_staff on lms.settings for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));

create policy learning_sessions_access on learning.sessions for select to authenticated
  using (
    core_student_id = core.current_student_id(academy_id)
    or core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor'])
  );
create policy learning_sessions_insert_own on learning.sessions for insert to authenticated
  with check (core_student_id = core.current_student_id(academy_id));

create policy learning_attempts_select on learning.attempts for select to authenticated
  using (
    core_student_id = core.current_student_id(academy_id)
    or core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor'])
  );
create policy learning_attempts_insert_own on learning.attempts for insert to authenticated
  with check (core_student_id = core.current_student_id(academy_id));

create policy learning_wrong_notes_access on learning.wrong_notes for all to authenticated
  using (
    core_student_id = core.current_student_id(academy_id)
    or core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor'])
  )
  with check (
    core_student_id = core.current_student_id(academy_id)
    or core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor'])
  );
create policy learning_reports_access on learning.reports for all to authenticated
  using (
    core_student_id = core.current_student_id(academy_id)
    or core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor'])
  )
  with check (
    core_student_id = core.current_student_id(academy_id)
    or core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor'])
  );

create policy ai_conversations_access on ai.conversations for all to authenticated
  using (
    student_id = core.current_student_id(academy_id)
    or core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor'])
  )
  with check (
    student_id = core.current_student_id(academy_id)
    or core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor'])
  );
create policy ai_messages_access on ai.messages for all to authenticated
  using (
    exists (
      select 1 from ai.conversations c
      where c.id = messages.conversation_id
        and (
          c.student_id = core.current_student_id(c.academy_id)
          or core.has_academy_role(c.academy_id, array['owner','admin','staff','teacher','instructor'])
        )
    )
  )
  with check (
    exists (
      select 1 from ai.conversations c
      where c.id = messages.conversation_id
        and (
          c.student_id = core.current_student_id(c.academy_id)
          or core.has_academy_role(c.academy_id, array['owner','admin','staff','teacher','instructor'])
        )
    )
  );

create policy data_events_access on data.events for select to authenticated
  using (
    (student_id is not null and core.can_access_student(student_id))
    or (academy_id is not null and core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor']))
  );
create policy data_events_insert on data.events for insert to authenticated
  with check (
    (student_id is null or core.can_access_student(student_id))
    and (academy_id is null or core.has_academy_role(academy_id, array['owner','admin','staff','teacher','instructor']) or student_id = core.current_student_id(academy_id))
  );

create policy audit_admin_select on audit.admin_actions for select to authenticated
  using (academy_id is not null and core.has_academy_role(academy_id, array['owner','admin']));
create policy audit_admin_insert on audit.admin_actions for insert to authenticated
  with check (academy_id is not null and core.has_academy_role(academy_id, array['owner','admin']));

-- ---------------------------------------------------------------------------
-- Grants for Supabase Data API

grant usage on schema core, content, learning, lms, ai, data, reporting, audit to anon, authenticated, service_role;
grant execute on function
  core.current_account_id(),
  core.current_person_id(),
  core.has_academy_role(uuid, text[]),
  core.current_student_id(uuid),
  core.can_access_student(uuid),
  core.can_access_book(uuid),
  content.problem_public_payload(jsonb)
to authenticated, service_role;

grant select, insert, update, delete on all tables in schema core to authenticated;
grant select on all tables in schema content to authenticated;
grant insert, update, delete on content.books to authenticated;
grant select, insert, update, delete on all tables in schema lms to authenticated;
grant select, insert, update on learning.sessions, learning.wrong_notes, learning.reports to authenticated;
grant select, insert on learning.attempts to authenticated;
grant select, insert, update on ai.conversations, ai.messages to authenticated;
grant select, insert on data.events to authenticated;
grant select, insert on audit.admin_actions to authenticated;
grant select on all tables in schema reporting to authenticated;

grant all privileges on all tables in schema core, content, learning, lms, ai, data, reporting, audit to service_role;
grant usage, select on all sequences in schema core, content, learning, lms, ai, data, audit to authenticated, service_role;

revoke update, delete on learning.attempts from authenticated;
revoke update, delete on data.events from authenticated;

alter default privileges in schema core grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema content grant select on tables to authenticated;
alter default privileges in schema lms grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema learning grant select on tables to authenticated;
alter default privileges in schema ai grant select on tables to authenticated;
alter default privileges in schema data grant select, insert on tables to authenticated;
alter default privileges in schema reporting grant select on tables to authenticated;
alter default privileges in schema core, content, learning, lms, ai, data, reporting, audit grant all on tables to service_role;
