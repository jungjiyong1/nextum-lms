-- Align nextum-data with the Next.js LMS contract while preserving grade-app
-- content and learning data. The legacy lms schema is intentionally replaced;
-- preservation backup was created before applying this migration.

create extension if not exists pgcrypto;

create schema if not exists core;
create schema if not exists content;
create schema if not exists learning;
create schema if not exists ai;
create schema if not exists data;
create schema if not exists reporting;
create schema if not exists audit;

-- ---------------------------------------------------------------------------
-- Shared compatibility columns

create or replace function core.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table core.academies add column if not exists status text;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'core'
      and table_name = 'academies'
      and column_name = 'active'
  ) then
    update core.academies set status = case when active then 'active' else 'inactive' end where status is null;
  else
    update core.academies set status = 'active' where status is null;
  end if;
end;
$$;
alter table core.academies alter column status set default 'active';
alter table core.academies alter column status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'core_academies_status_check'
      and conrelid = 'core.academies'::regclass
  ) then
    alter table core.academies
      add constraint core_academies_status_check
      check (status in ('active', 'inactive', 'archived'));
  end if;
end;
$$;

alter table core.people add column if not exists display_name text;
alter table core.people add column if not exists parent_name text;
alter table core.people add column if not exists parent_phone text;
update core.people set display_name = full_name where display_name is null;

alter table core.classes add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table core.class_students add column if not exists status text not null default 'active';
alter table core.class_students add column if not exists ended_at timestamptz;
alter table core.class_students add column if not exists primary_class boolean not null default false;
alter table core.class_students add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'core_class_students_status_check'
      and conrelid = 'core.class_students'::regclass
  ) then
    alter table core.class_students
      add constraint core_class_students_status_check
      check (status in ('active', 'pending', 'on_leave', 'completed', 'dropped'));
  end if;
end;
$$;

alter table core.class_books add column if not exists active boolean not null default true;
alter table core.class_books add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table content.books add column if not exists academy_id uuid references core.academies (id) on delete cascade;
alter table content.books add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table content.concepts add column if not exists unit_id uuid references content.units (id) on delete cascade;
update content.concepts c
set unit_id = p.unit_id
from content.problems p
where c.unit_id is null
  and p.concept_id = c.id;

alter table content.problem_types add column if not exists unit_id uuid references content.units (id) on delete cascade;
alter table content.problem_types add column if not exists sort_order integer not null default 0;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'content'
      and table_name = 'problems'
      and column_name = 'type_id'
  ) then
    update content.problem_types pt
    set unit_id = p.unit_id
    from content.problems p
    where pt.unit_id is null
      and p.type_id = pt.id;
  end if;
end;
$$;

alter table content.problems add column if not exists problem_type_id uuid references content.problem_types (id) on delete set null;
alter table content.problems add column if not exists metadata jsonb not null default '{}'::jsonb;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'content'
      and table_name = 'problems'
      and column_name = 'type_id'
  ) then
    update content.problems
    set problem_type_id = type_id
    where problem_type_id is null
      and type_id is not null;
  end if;
end;
$$;

alter table content.assets add column if not exists kind text not null default 'problem_image';
alter table content.assets add column if not exists media_type text;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'content'
      and table_name = 'assets'
      and column_name = 'asset_type'
  ) then
    update content.assets set kind = asset_type where kind = 'problem_image' and asset_type is not null;
  end if;
end;
$$;

alter table content.problem_reports add column if not exists academy_id uuid references core.academies (id) on delete cascade;
alter table content.problem_reports add column if not exists core_student_id uuid references core.students (id) on delete set null;
alter table content.problem_reports add column if not exists metadata jsonb not null default '{}'::jsonb;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'content'
      and table_name = 'problem_reports'
      and column_name = 'student_id'
  ) then
    update content.problem_reports pr
    set core_student_id = pr.student_id
    where pr.core_student_id is null
      and exists (select 1 from core.students s where s.id = pr.student_id);
  end if;
end;
$$;
update content.problem_reports pr
set academy_id = s.academy_id
from core.students s
where pr.academy_id is null
  and s.id = pr.core_student_id;

alter table learning.sessions add column if not exists academy_id uuid references core.academies (id) on delete cascade;
alter table learning.sessions add column if not exists metadata jsonb not null default '{}'::jsonb;
update learning.sessions se
set academy_id = st.academy_id
from core.students st
where se.academy_id is null
  and st.id = se.core_student_id;

alter table learning.attempts add column if not exists academy_id uuid references core.academies (id) on delete cascade;
alter table learning.attempts add column if not exists metadata jsonb not null default '{}'::jsonb;
update learning.attempts a
set academy_id = se.academy_id
from learning.sessions se
where a.academy_id is null
  and se.id = a.session_id
  and se.academy_id is not null;
update learning.attempts a
set academy_id = st.academy_id
from core.students st
where a.academy_id is null
  and st.id = a.core_student_id;

alter table learning.wrong_notes add column if not exists academy_id uuid references core.academies (id) on delete cascade;
alter table learning.wrong_notes add column if not exists core_student_id uuid references core.students (id) on delete cascade;
alter table learning.wrong_notes add column if not exists metadata jsonb not null default '{}'::jsonb;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'learning'
      and table_name = 'wrong_notes'
      and column_name = 'student_id'
  ) then
    update learning.wrong_notes wn
    set core_student_id = wn.student_id
    where wn.core_student_id is null
      and exists (select 1 from core.students st where st.id = wn.student_id);
  end if;
end;
$$;
update learning.wrong_notes wn
set academy_id = st.academy_id
from core.students st
where wn.academy_id is null
  and st.id = wn.core_student_id;

alter table learning.reports add column if not exists academy_id uuid references core.academies (id) on delete cascade;
alter table learning.reports add column if not exists core_student_id uuid references core.students (id) on delete set null;
alter table learning.reports add column if not exists report_type text not null default 'progress';
alter table learning.reports add column if not exists title text;
alter table learning.reports add column if not exists period_start date;
alter table learning.reports add column if not exists period_end date;
alter table learning.reports add column if not exists generated_by uuid references core.people (id) on delete set null;
alter table learning.reports add column if not exists generated_at timestamptz not null default now();
alter table learning.reports add column if not exists payload jsonb not null default '{}'::jsonb;
alter table learning.reports add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table learning.reports add column if not exists updated_at timestamptz not null default now();
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'learning'
      and table_name = 'reports'
      and column_name = 'student_id'
  ) then
    update learning.reports r
    set core_student_id = r.student_id
    where r.core_student_id is null
      and exists (select 1 from core.students st where st.id = r.student_id);
  end if;
end;
$$;
update learning.reports r
set academy_id = st.academy_id
from core.students st
where r.academy_id is null
  and st.id = r.core_student_id;

alter table ai.conversations add column if not exists core_student_id uuid references core.students (id) on delete cascade;
alter table ai.conversations add column if not exists provider text;
alter table ai.conversations add column if not exists provider_thread_id text;
update ai.conversations c
set core_student_id = c.student_id
where c.core_student_id is null
  and exists (select 1 from core.students st where st.id = c.student_id);
update ai.conversations c
set academy_id = st.academy_id
from core.students st
where c.academy_id is null
  and st.id = c.core_student_id;

alter table data.events add column if not exists class_id uuid references core.classes (id) on delete set null;

create table if not exists audit.admin_actions (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid references core.academies (id) on delete set null,
  actor_id    uuid references core.people (id) on delete set null,
  action      text not null,
  target      text,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Safe content contract functions and views

create or replace function content.problem_public_payload(answer jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog
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

create or replace function content.set_problem_answer_contract()
returns trigger
language plpgsql
set search_path = content, public
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

drop trigger if exists set_problem_answer_contract on content.problems;
create trigger set_problem_answer_contract
  before insert or update on content.problems
  for each row execute function content.set_problem_answer_contract();

drop view if exists content.student_problems;
create view content.student_problems
with (security_invoker = true) as
select
  id,
  book_id,
  unit_id,
  concept_id,
  problem_type_id,
  page_printed,
  number,
  image_path,
  public_payload,
  position_in_type,
  is_example,
  difficulty_hint,
  verified,
  created_at,
  updated_at
from content.problems;

-- ---------------------------------------------------------------------------
-- Replace legacy LMS operational schema

drop schema if exists lms cascade;
create schema lms;

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
  unique (academy_id, name),
  check (capacity is null or capacity >= 0)
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
  check (end_time > start_time)
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
  line_amount    numeric(12, 2) generated always as (amount) stored,
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
  status         text not null default 'paid' check (status in ('pending', 'paid', 'cancelled')),
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
-- Indexes and same-academy constraints

create index if not exists core_people_academy_idx on core.people (primary_academy_id);
create index if not exists core_students_academy_idx on core.students (academy_id, status);
create index if not exists core_students_person_idx on core.students (person_id);
create unique index if not exists core_students_id_academy_key on core.students (id, academy_id);
create index if not exists core_staff_academy_idx on core.staff_members (academy_id, status);
create unique index if not exists core_staff_id_academy_key on core.staff_members (id, academy_id);
create index if not exists core_members_account_idx on core.academy_members (user_account_id);
create index if not exists core_members_person_idx on core.academy_members (person_id);
create index if not exists core_classes_academy_idx on core.classes (academy_id, active);
create unique index if not exists core_classes_id_academy_key on core.classes (id, academy_id);
create index if not exists core_class_students_student_idx on core.class_students (student_id, status);
create index if not exists core_class_books_book_idx on core.class_books (book_id);

create index if not exists content_units_book_idx on content.units (book_id, sort_order);
create index if not exists content_concepts_book_idx on content.concepts (book_id, unit_id);
create index if not exists content_problem_types_book_idx on content.problem_types (book_id, unit_id);
create index if not exists content_problems_book_idx on content.problems (book_id, unit_id);
create index if not exists content_problems_type_idx on content.problems (problem_type_id) where problem_type_id is not null;
create index if not exists content_assets_problem_idx on content.assets (problem_id);
create index if not exists content_problem_reports_student_idx on content.problem_reports (academy_id, core_student_id, status);
create index if not exists content_problem_reports_problem_idx on content.problem_reports (problem_id, status);

create index if not exists learning_sessions_student_idx on learning.sessions (core_student_id, started_at desc);
create index if not exists learning_attempts_student_problem_idx on learning.attempts (core_student_id, problem_id);
create index if not exists learning_attempts_session_idx on learning.attempts (session_id);
create index if not exists learning_reports_student_idx on learning.reports (academy_id, core_student_id, generated_at desc);
create index if not exists learning_reports_type_idx on learning.reports (academy_id, report_type, status);
create index if not exists ai_conversations_student_idx on ai.conversations (student_id, created_at desc);
create index if not exists ai_messages_conversation_idx on ai.messages (conversation_id, created_at);
create index if not exists data_events_student_time_idx on data.events (student_id, occurred_at desc);
create index if not exists data_events_class_time_idx on data.events (class_id, occurred_at desc);

create index lms_class_profiles_academy_idx on lms.class_profiles (academy_id, status);
create unique index lms_classrooms_id_academy_key on lms.classrooms (id, academy_id);
create unique index lms_rules_id_academy_key on lms.class_schedule_rules (id, academy_id);
create index lms_rules_class_idx on lms.class_schedule_rules (class_id, active);
create index lms_occurrences_class_date_idx on lms.lesson_occurrences (class_id, occurrence_date);
create index lms_occurrences_academy_date_idx on lms.lesson_occurrences (academy_id, occurrence_date);
create unique index lms_occurrences_id_academy_key on lms.lesson_occurrences (id, academy_id);
create unique index lms_occurrences_class_rule_time_key
  on lms.lesson_occurrences (class_id, occurrence_date, start_time, coalesce(rule_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index lms_attendance_student_idx on lms.attendance_records (student_id, created_at desc);
create index lms_contracts_student_idx on lms.student_billing_contracts (student_id, status);
create unique index lms_active_contract_one_per_student_idx
  on lms.student_billing_contracts (student_id)
  where status = 'active' and effective_to is null;
create unique index lms_contracts_id_academy_key on lms.student_billing_contracts (id, academy_id);
create unique index lms_billing_class_rules_contract_class_key on lms.billing_class_rules (contract_id, class_id);
create index lms_invoices_student_month_idx on lms.invoices (student_id, service_month);
create unique index lms_invoices_id_academy_key on lms.invoices (id, academy_id);
create index lms_payments_student_date_idx on lms.payments (student_id, payment_date desc);
create index lms_payroll_instructor_month_idx on lms.instructor_payments (instructor_id, service_month);

alter table lms.class_profiles
  add constraint lms_class_profiles_class_same_academy
  foreign key (class_id, academy_id) references core.classes (id, academy_id);

alter table lms.class_schedule_rules
  add constraint lms_rules_class_same_academy
  foreign key (class_id, academy_id) references core.classes (id, academy_id),
  add constraint lms_rules_classroom_same_academy
  foreign key (classroom_id, academy_id) references lms.classrooms (id, academy_id),
  add constraint lms_rules_instructor_same_academy
  foreign key (instructor_staff_id, academy_id) references core.staff_members (id, academy_id),
  add constraint lms_rules_date_order check (end_date is null or end_date >= start_date);

alter table lms.lesson_occurrences
  add constraint lms_occurrences_class_same_academy
  foreign key (class_id, academy_id) references core.classes (id, academy_id),
  add constraint lms_occurrences_rule_same_academy
  foreign key (rule_id, academy_id) references lms.class_schedule_rules (id, academy_id),
  add constraint lms_occurrences_classroom_same_academy
  foreign key (classroom_id, academy_id) references lms.classrooms (id, academy_id),
  add constraint lms_occurrences_instructor_same_academy
  foreign key (instructor_staff_id, academy_id) references core.staff_members (id, academy_id),
  add constraint lms_occurrences_substitute_same_academy
  foreign key (substitute_staff_id, academy_id) references core.staff_members (id, academy_id);

alter table lms.attendance_records
  add constraint lms_attendance_occurrence_same_academy
  foreign key (occurrence_id, academy_id) references lms.lesson_occurrences (id, academy_id),
  add constraint lms_attendance_student_same_academy
  foreign key (student_id, academy_id) references core.students (id, academy_id);

alter table lms.student_billing_contracts
  add constraint lms_contracts_student_same_academy
  foreign key (student_id, academy_id) references core.students (id, academy_id);

alter table lms.billing_class_rules
  add constraint lms_billing_rules_contract_same_academy
  foreign key (contract_id, academy_id) references lms.student_billing_contracts (id, academy_id),
  add constraint lms_billing_rules_class_same_academy
  foreign key (class_id, academy_id) references core.classes (id, academy_id);

alter table lms.invoices
  add constraint lms_invoices_student_same_academy
  foreign key (student_id, academy_id) references core.students (id, academy_id),
  add constraint lms_invoices_amounts_valid check (subtotal_amount >= 0 and discount_amount >= 0 and total_amount >= 0 and paid_amount >= 0);

alter table lms.invoice_lines
  add constraint lms_invoice_lines_amount_valid check (quantity >= 0);

alter table lms.payments
  add constraint lms_payments_invoice_same_academy
  foreign key (invoice_id, academy_id) references lms.invoices (id, academy_id),
  add constraint lms_payments_student_same_academy
  foreign key (student_id, academy_id) references core.students (id, academy_id);

-- ---------------------------------------------------------------------------
-- RLS helper functions

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

create or replace function core.current_staff_id(check_academy_id uuid)
returns uuid
language sql
stable
security definer
set search_path = core, public
as $$
  select sm.id
  from core.staff_members sm
  where sm.academy_id = check_academy_id
    and sm.status = 'active'
    and sm.person_id = core.current_person_id()
  limit 1
$$;

create or replace function core.can_access_assigned_class(check_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = core, lms, public
as $$
  with class_row as (
    select c.id, c.academy_id, core.current_staff_id(c.academy_id) as staff_id
    from core.classes c
    where c.id = check_class_id
  )
  select exists (
    select 1
    from class_row c
    where c.staff_id is not null
      and core.has_academy_role(c.academy_id, array['teacher','instructor'])
      and (
        exists (
          select 1 from lms.class_profiles cp
          where cp.class_id = c.id
            and cp.default_instructor_staff_id = c.staff_id
        )
        or exists (
          select 1 from lms.class_schedule_rules csr
          where csr.class_id = c.id
            and csr.active
            and csr.instructor_staff_id = c.staff_id
        )
        or exists (
          select 1 from lms.lesson_occurrences lo
          where lo.class_id = c.id
            and (lo.instructor_staff_id = c.staff_id or lo.substitute_staff_id = c.staff_id)
        )
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

create or replace function core.can_access_class(check_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1
    from core.classes c
    where c.id = check_class_id
      and (
        core.has_academy_role(c.academy_id, array['owner','admin','staff'])
        or core.can_access_assigned_class(c.id)
        or exists (
          select 1 from core.class_students cs
          where cs.class_id = c.id
            and cs.student_id = core.current_student_id(c.academy_id)
            and cs.status = 'active'
        )
      )
  )
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
        or core.has_academy_role(s.academy_id, array['owner','admin','staff'])
        or (
          core.has_academy_role(s.academy_id, array['teacher','instructor'])
          and exists (
            select 1
            from core.class_students cs
            where cs.student_id = s.id
              and cs.status = 'active'
              and core.can_access_assigned_class(cs.class_id)
          )
        )
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
        (b.academy_id is not null and core.has_academy_role(b.academy_id, array['owner','admin','staff']))
        or exists (
          select 1
          from core.class_books cb
          join core.classes c on c.id = cb.class_id and c.active
          where cb.book_id = b.id
            and cb.active
            and core.can_access_class(c.id)
        )
      )
  )
$$;

create or replace function content.can_report_problem(check_problem_id text)
returns boolean
language sql
stable
security invoker
set search_path = content, core, public
as $$
  select exists (
    select 1
    from content.problems p
    where p.id = check_problem_id
      and core.can_access_book(p.book_id)
  )
$$;

-- ---------------------------------------------------------------------------
-- LMS reset RPC and reporting views

create or replace function lms.reset_academy_data(p_academy_id uuid, p_target text)
returns jsonb
language plpgsql
security invoker
set search_path = lms, core, public
as $$
declare
  normalized_target text := lower(coalesce(p_target, ''));
  summaries jsonb := '[]'::jsonb;
  affected integer := 0;
begin
  if normalized_target not in ('classrooms', 'classes', 'lessons', 'schedules', 'students', 'instructors', 'courses', 'enrollments', 'accounting', 'all') then
    raise exception 'Unsupported reset target: %', p_target;
  end if;

  if normalized_target in ('lessons', 'all') then
    delete from lms.attendance_records where academy_id = p_academy_id;
    get diagnostics affected = row_count;
    summaries := summaries || jsonb_build_array(jsonb_build_object('schema', 'lms', 'table', 'attendance_records', 'operation', 'delete', 'affectedRows', affected));

    delete from lms.lesson_occurrences where academy_id = p_academy_id;
    get diagnostics affected = row_count;
    summaries := summaries || jsonb_build_array(jsonb_build_object('schema', 'lms', 'table', 'lesson_occurrences', 'operation', 'delete', 'affectedRows', affected));
  end if;

  if normalized_target in ('schedules', 'all') then
    delete from lms.class_schedule_rules where academy_id = p_academy_id;
    get diagnostics affected = row_count;
    summaries := summaries || jsonb_build_array(jsonb_build_object('schema', 'lms', 'table', 'class_schedule_rules', 'operation', 'delete', 'affectedRows', affected));
  end if;

  if normalized_target in ('classes', 'all') then
    delete from lms.class_profiles where academy_id = p_academy_id;
    get diagnostics affected = row_count;
    summaries := summaries || jsonb_build_array(jsonb_build_object('schema', 'lms', 'table', 'class_profiles', 'operation', 'delete', 'affectedRows', affected));

    delete from core.class_books cb
    using core.classes c
    where cb.class_id = c.id
      and c.academy_id = p_academy_id;
    get diagnostics affected = row_count;
    summaries := summaries || jsonb_build_array(jsonb_build_object('schema', 'core', 'table', 'class_books', 'operation', 'delete', 'affectedRows', affected));

    update core.class_students cs
    set status = 'dropped',
        ended_at = coalesce(ended_at, now())
    from core.classes c
    where cs.class_id = c.id
      and c.academy_id = p_academy_id
      and cs.status = 'active';
    get diagnostics affected = row_count;
    summaries := summaries || jsonb_build_array(jsonb_build_object('schema', 'core', 'table', 'class_students', 'operation', 'archive', 'affectedRows', affected));

    update core.classes
    set active = false
    where academy_id = p_academy_id
      and active;
    get diagnostics affected = row_count;
    summaries := summaries || jsonb_build_array(jsonb_build_object('schema', 'core', 'table', 'classes', 'operation', 'deactivate', 'affectedRows', affected));
  end if;

  if normalized_target in ('enrollments', 'all') then
    update core.class_students cs
    set status = 'dropped',
        ended_at = coalesce(ended_at, now())
    from core.classes c
    where cs.class_id = c.id
      and c.academy_id = p_academy_id
      and cs.status = 'active';
    get diagnostics affected = row_count;
    summaries := summaries || jsonb_build_array(jsonb_build_object('schema', 'core', 'table', 'class_students', 'operation', 'archive', 'affectedRows', affected));
  end if;

  if normalized_target in ('students', 'all') then
    update lms.student_billing_contracts
    set status = 'archived',
        effective_to = coalesce(effective_to, current_date)
    where academy_id = p_academy_id
      and status = 'active';
    get diagnostics affected = row_count;
    summaries := summaries || jsonb_build_array(jsonb_build_object('schema', 'lms', 'table', 'student_billing_contracts', 'operation', 'archive', 'affectedRows', affected));

    update core.students
    set status = 'dropped'
    where academy_id = p_academy_id
      and status = 'active';
    get diagnostics affected = row_count;
    summaries := summaries || jsonb_build_array(jsonb_build_object('schema', 'core', 'table', 'students', 'operation', 'archive', 'affectedRows', affected));
  end if;

  if normalized_target in ('instructors', 'all') then
    update core.staff_members
    set status = 'inactive'
    where academy_id = p_academy_id
      and role in ('teacher', 'instructor')
      and status = 'active';
    get diagnostics affected = row_count;
    summaries := summaries || jsonb_build_array(jsonb_build_object('schema', 'core', 'table', 'staff_members', 'operation', 'deactivate', 'affectedRows', affected));
  end if;

  if normalized_target in ('courses', 'all') then
    update lms.courses
    set status = 'archived'
    where academy_id = p_academy_id
      and status = 'active';
    get diagnostics affected = row_count;
    summaries := summaries || jsonb_build_array(jsonb_build_object('schema', 'lms', 'table', 'courses', 'operation', 'archive', 'affectedRows', affected));
  end if;

  if normalized_target in ('accounting', 'all') then
    delete from lms.payments where academy_id = p_academy_id;
    get diagnostics affected = row_count;
    summaries := summaries || jsonb_build_array(jsonb_build_object('schema', 'lms', 'table', 'payments', 'operation', 'delete', 'affectedRows', affected));

    delete from lms.invoice_lines il
    using lms.invoices i
    where il.invoice_id = i.id
      and i.academy_id = p_academy_id;
    get diagnostics affected = row_count;
    summaries := summaries || jsonb_build_array(jsonb_build_object('schema', 'lms', 'table', 'invoice_lines', 'operation', 'delete', 'affectedRows', affected));

    delete from lms.invoices where academy_id = p_academy_id;
    get diagnostics affected = row_count;
    summaries := summaries || jsonb_build_array(jsonb_build_object('schema', 'lms', 'table', 'invoices', 'operation', 'delete', 'affectedRows', affected));

    delete from lms.expenses where academy_id = p_academy_id;
    get diagnostics affected = row_count;
    summaries := summaries || jsonb_build_array(jsonb_build_object('schema', 'lms', 'table', 'expenses', 'operation', 'delete', 'affectedRows', affected));

    delete from lms.instructor_payments where academy_id = p_academy_id;
    get diagnostics affected = row_count;
    summaries := summaries || jsonb_build_array(jsonb_build_object('schema', 'lms', 'table', 'instructor_payments', 'operation', 'delete', 'affectedRows', affected));
  end if;

  if normalized_target in ('classrooms', 'all') then
    delete from lms.classrooms where academy_id = p_academy_id;
    get diagnostics affected = row_count;
    summaries := summaries || jsonb_build_array(jsonb_build_object('schema', 'lms', 'table', 'classrooms', 'operation', 'delete', 'affectedRows', affected));
  end if;

  return jsonb_build_object(
    'target', normalized_target,
    'tables', summaries,
    'totalAffectedRows', coalesce((
      select sum((entry->>'affectedRows')::integer)
      from jsonb_array_elements(summaries) as entry
    ), 0)
  );
end;
$$;

drop view if exists reporting.v_class_learning_summary;
drop view if exists reporting.v_student_type_weakness;

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
    and a.academy_id is not null
    and a.core_student_id is not null
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

create or replace function lms.ensure_attendance_student_in_class()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from lms.lesson_occurrences lo
    join core.class_students cs
      on cs.class_id = lo.class_id
     and cs.student_id = new.student_id
     and cs.status = 'active'
    where lo.id = new.occurrence_id
      and lo.academy_id = new.academy_id
  ) then
    raise exception 'Attendance student must be actively enrolled in the occurrence class.';
  end if;

  return new;
end;
$$;

drop trigger if exists set_academies_updated_at on core.academies;
create trigger set_academies_updated_at before update on core.academies for each row execute function core.set_updated_at();
drop trigger if exists set_people_updated_at on core.people;
create trigger set_people_updated_at before update on core.people for each row execute function core.set_updated_at();
drop trigger if exists set_classes_updated_at on core.classes;
create trigger set_classes_updated_at before update on core.classes for each row execute function core.set_updated_at();
drop trigger if exists set_content_problem_reports_updated_at on content.problem_reports;
create trigger set_content_problem_reports_updated_at before update on content.problem_reports for each row execute function core.set_updated_at();
drop trigger if exists set_learning_reports_updated_at on learning.reports;
create trigger set_learning_reports_updated_at before update on learning.reports for each row execute function core.set_updated_at();
drop trigger if exists set_ai_conversations_updated_at on ai.conversations;
create trigger set_ai_conversations_updated_at before update on ai.conversations for each row execute function core.set_updated_at();

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

create trigger ensure_attendance_student_in_class
  before insert or update on lms.attendance_records
  for each row execute function lms.ensure_attendance_student_in_class();

-- ---------------------------------------------------------------------------
-- Row level security and policies

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
alter table content.problem_reports enable row level security;
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

drop policy if exists classes_access on core.classes;
drop policy if exists classes_staff_write on core.classes;
drop policy if exists classes_member on core.classes;
drop policy if exists class_students_access on core.class_students;
drop policy if exists class_students_staff_write on core.class_students;
drop policy if exists class_students_self on core.class_students;
drop policy if exists class_books_access on core.class_books;
drop policy if exists class_books_staff_write on core.class_books;
drop policy if exists class_books_member on core.class_books;
drop policy if exists people_access on core.people;
drop policy if exists students_access on core.students;
drop policy if exists staff_members_access on core.staff_members;
drop policy if exists academy_members_access on core.academy_members;
drop policy if exists members_access on core.academy_members;

create policy people_access on core.people for select to authenticated
  using (
    id = core.current_person_id()
    or (primary_academy_id is not null and core.has_academy_role(primary_academy_id, array['owner','admin','staff']))
  );

create policy students_access on core.students for select to authenticated
  using (core.can_access_student(id));

create policy staff_members_access on core.staff_members for select to authenticated
  using (
    person_id = core.current_person_id()
    or core.has_academy_role(academy_id, array['owner','admin','staff'])
    or (
      core.has_academy_role(academy_id, array['teacher','instructor'])
      and id = core.current_staff_id(academy_id)
    )
  );

create policy members_access on core.academy_members for select to authenticated
  using (
    person_id = core.current_person_id()
    or core.has_academy_role(academy_id, array['owner','admin','staff'])
  );

create policy classes_access on core.classes for select to authenticated
  using (core.can_access_class(id));

create policy classes_staff_write on core.classes for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));

create policy class_students_access on core.class_students for select to authenticated
  using (
    exists (
      select 1 from core.classes c
      where c.id = class_students.class_id
        and (
          core.has_academy_role(c.academy_id, array['owner','admin','staff'])
          or (
            core.has_academy_role(c.academy_id, array['teacher','instructor'])
            and core.can_access_assigned_class(class_students.class_id)
          )
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
        and core.can_access_class(c.id)
    )
  );

create policy class_books_staff_write on core.class_books for all to authenticated
  using (
    exists (select 1 from core.classes c where c.id = class_books.class_id and core.has_academy_role(c.academy_id, array['owner','admin','staff']))
  )
  with check (
    exists (select 1 from core.classes c where c.id = class_books.class_id and core.has_academy_role(c.academy_id, array['owner','admin','staff']))
  );

drop policy if exists content_books_select on content.books;
drop policy if exists content_units_select on content.units;
drop policy if exists content_concepts_select on content.concepts;
drop policy if exists content_problem_types_select on content.problem_types;
drop policy if exists content_problems_select on content.problems;
drop policy if exists content_assets_select on content.assets;
drop policy if exists content_problem_reports_select on content.problem_reports;
drop policy if exists content_problem_reports_insert on content.problem_reports;
drop policy if exists content_problem_reports_update on content.problem_reports;
drop policy if exists content_problem_reports_delete on content.problem_reports;
drop policy if exists content_staff_write_books on content.books;

create policy content_books_select on content.books for select to authenticated
  using (core.can_access_book(id));
create policy content_units_select on content.units for select to authenticated
  using (core.can_access_book(book_id));
create policy content_concepts_select on content.concepts for select to authenticated
  using (core.can_access_book(book_id));
create policy content_problem_types_select on content.problem_types for select to authenticated
  using (core.can_access_book(book_id));
create policy content_problems_select on content.problems for select to authenticated
  using (core.can_access_book(book_id));
create policy content_assets_select on content.assets for select to authenticated
  using (book_id is not null and core.can_access_book(book_id));
create policy content_problem_reports_select on content.problem_reports for select to authenticated
  using (core_student_id is not null and core.can_access_student(core_student_id));
create policy content_problem_reports_insert on content.problem_reports for insert to authenticated
  with check (
    content.can_report_problem(problem_id)
    and (
      core_student_id = core.current_student_id(academy_id)
      or core.has_academy_role(academy_id, array['owner','admin','staff'])
    )
  );
create policy content_problem_reports_update on content.problem_reports for update to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (
    content.can_report_problem(problem_id)
    and core.has_academy_role(academy_id, array['owner','admin','staff'])
  );
create policy content_problem_reports_delete on content.problem_reports for delete to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy content_staff_write_books on content.books for all to authenticated
  using (academy_id is not null and core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (academy_id is not null and core.has_academy_role(academy_id, array['owner','admin','staff']));

create policy lms_courses_select on lms.courses for select to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_courses_write on lms.courses for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_classrooms_select on lms.classrooms for select to authenticated
  using (
    core.has_academy_role(academy_id, array['owner','admin','staff'])
    or exists (select 1 from lms.class_profiles cp where cp.default_classroom_id = classrooms.id and core.can_access_assigned_class(cp.class_id))
    or exists (select 1 from lms.class_schedule_rules csr where csr.classroom_id = classrooms.id and core.can_access_assigned_class(csr.class_id))
    or exists (select 1 from lms.lesson_occurrences lo where lo.classroom_id = classrooms.id and core.can_access_assigned_class(lo.class_id))
  );
create policy lms_classrooms_write on lms.classrooms for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_class_profiles_select on lms.class_profiles for select to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']) or core.can_access_assigned_class(class_id));
create policy lms_class_profiles_write on lms.class_profiles for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_rules_select on lms.class_schedule_rules for select to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']) or core.can_access_assigned_class(class_id));
create policy lms_rules_insert on lms.class_schedule_rules for insert to authenticated
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_rules_update on lms.class_schedule_rules for update to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_rules_delete on lms.class_schedule_rules for delete to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_occurrences_select on lms.lesson_occurrences for select to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']) or core.can_access_assigned_class(class_id));
create policy lms_occurrences_insert on lms.lesson_occurrences for insert to authenticated
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_occurrences_update on lms.lesson_occurrences for update to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_occurrences_delete on lms.lesson_occurrences for delete to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_attendance_select on lms.attendance_records for select to authenticated
  using (
    core.has_academy_role(academy_id, array['owner','admin','staff'])
    or student_id = core.current_student_id(academy_id)
    or exists (
      select 1 from lms.lesson_occurrences lo
      where lo.id = attendance_records.occurrence_id
        and core.can_access_assigned_class(lo.class_id)
    )
  );
create policy lms_attendance_insert on lms.attendance_records for insert to authenticated
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_attendance_update on lms.attendance_records for update to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy lms_attendance_delete on lms.attendance_records for delete to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']));
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
  using (exists (select 1 from lms.invoices i where i.id = invoice_lines.invoice_id and core.has_academy_role(i.academy_id, array['owner','admin','staff'])))
  with check (exists (select 1 from lms.invoices i where i.id = invoice_lines.invoice_id and core.has_academy_role(i.academy_id, array['owner','admin','staff'])));
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

drop policy if exists learning_sessions_access on learning.sessions;
drop policy if exists learning_sessions_insert_own on learning.sessions;
drop policy if exists learning_attempts_select on learning.attempts;
drop policy if exists learning_attempts_insert_own on learning.attempts;
drop policy if exists learning_wrong_notes_select on learning.wrong_notes;
drop policy if exists learning_wrong_notes_insert on learning.wrong_notes;
drop policy if exists learning_wrong_notes_update on learning.wrong_notes;
drop policy if exists learning_wrong_notes_delete on learning.wrong_notes;
drop policy if exists learning_reports_select on learning.reports;
drop policy if exists learning_reports_insert on learning.reports;
drop policy if exists learning_reports_update on learning.reports;

create policy learning_sessions_access on learning.sessions for select to authenticated
  using (core_student_id is not null and core.can_access_student(core_student_id));
create policy learning_sessions_insert_own on learning.sessions for insert to authenticated
  with check (core_student_id = core.current_student_id(academy_id));
create policy learning_attempts_select on learning.attempts for select to authenticated
  using (core_student_id is not null and core.can_access_student(core_student_id));
create policy learning_attempts_insert_own on learning.attempts for insert to authenticated
  with check (core_student_id = core.current_student_id(academy_id));
create policy learning_wrong_notes_select on learning.wrong_notes for select to authenticated
  using (core_student_id is not null and core.can_access_student(core_student_id));
create policy learning_wrong_notes_insert on learning.wrong_notes for insert to authenticated
  with check (
    core_student_id = core.current_student_id(academy_id)
    or core.has_academy_role(academy_id, array['owner','admin','staff'])
  );
create policy learning_wrong_notes_update on learning.wrong_notes for update to authenticated
  using (
    core_student_id = core.current_student_id(academy_id)
    or core.has_academy_role(academy_id, array['owner','admin','staff'])
  )
  with check (
    core_student_id = core.current_student_id(academy_id)
    or core.has_academy_role(academy_id, array['owner','admin','staff'])
  );
create policy learning_wrong_notes_delete on learning.wrong_notes for delete to authenticated
  using (
    core_student_id = core.current_student_id(academy_id)
    or core.has_academy_role(academy_id, array['owner','admin','staff'])
  );
create policy learning_reports_select on learning.reports for select to authenticated
  using (
    (status = 'published' and core_student_id = core.current_student_id(academy_id))
    or core.has_academy_role(academy_id, array['owner','admin','staff'])
    or (
      core.has_academy_role(academy_id, array['teacher','instructor'])
      and core_student_id is not null
      and core.can_access_student(core_student_id)
    )
  );
create policy learning_reports_insert on learning.reports for insert to authenticated
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));
create policy learning_reports_update on learning.reports for update to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));

drop policy if exists ai_conversations_select on ai.conversations;
drop policy if exists ai_conversations_insert on ai.conversations;
drop policy if exists ai_conversations_update on ai.conversations;
drop policy if exists ai_messages_select on ai.messages;
drop policy if exists ai_messages_insert on ai.messages;
drop policy if exists data_events_access on data.events;
drop policy if exists data_events_insert on data.events;
drop policy if exists audit_admin_select on audit.admin_actions;
drop policy if exists audit_admin_insert on audit.admin_actions;

create policy ai_conversations_select on ai.conversations for select to authenticated
  using (coalesce(core_student_id, student_id) is not null and core.can_access_student(coalesce(core_student_id, student_id)));
create policy ai_conversations_insert on ai.conversations for insert to authenticated
  with check (
    coalesce(core_student_id, student_id) = core.current_student_id(academy_id)
    or core.has_academy_role(academy_id, array['owner','admin','staff'])
  );
create policy ai_conversations_update on ai.conversations for update to authenticated
  using (
    coalesce(core_student_id, student_id) = core.current_student_id(academy_id)
    or core.has_academy_role(academy_id, array['owner','admin','staff'])
  )
  with check (
    coalesce(core_student_id, student_id) = core.current_student_id(academy_id)
    or core.has_academy_role(academy_id, array['owner','admin','staff'])
  );
create policy ai_messages_select on ai.messages for select to authenticated
  using (
    exists (
      select 1 from ai.conversations c
      where c.id = messages.conversation_id
        and core.can_access_student(coalesce(c.core_student_id, c.student_id))
    )
  );
create policy ai_messages_insert on ai.messages for insert to authenticated
  with check (
    exists (
      select 1 from ai.conversations c
      where c.id = messages.conversation_id
        and (
          coalesce(c.core_student_id, c.student_id) = core.current_student_id(c.academy_id)
          or core.has_academy_role(c.academy_id, array['owner','admin','staff'])
        )
    )
  );
create policy data_events_access on data.events for select to authenticated
  using (
    (student_id is not null and core.can_access_student(student_id))
    or (academy_id is not null and core.has_academy_role(academy_id, array['owner','admin','staff']))
  );
create policy data_events_insert on data.events for insert to authenticated
  with check (
    (student_id is null or core.can_access_student(student_id))
    and (academy_id is null or core.has_academy_role(academy_id, array['owner','admin','staff']) or student_id = core.current_student_id(academy_id))
  );
create policy audit_admin_select on audit.admin_actions for select to authenticated
  using (academy_id is not null and core.has_academy_role(academy_id, array['owner','admin']));
create policy audit_admin_insert on audit.admin_actions for insert to authenticated
  with check (academy_id is not null and core.has_academy_role(academy_id, array['owner','admin']));

-- ---------------------------------------------------------------------------
-- Grants for Supabase Data API

grant usage on schema core, content, learning, lms, ai, data, reporting, audit to anon, authenticated, service_role;

revoke execute on function
  core.current_account_id(),
  core.current_person_id(),
  core.has_academy_role(uuid, text[]),
  core.current_staff_id(uuid),
  core.can_access_assigned_class(uuid),
  core.current_student_id(uuid),
  core.can_access_class(uuid),
  core.can_access_student(uuid),
  core.can_access_book(uuid),
  content.can_report_problem(text),
  content.problem_public_payload(jsonb)
from public, anon;
grant execute on function
  core.current_account_id(),
  core.current_person_id(),
  core.has_academy_role(uuid, text[]),
  core.current_staff_id(uuid),
  core.can_access_assigned_class(uuid),
  core.current_student_id(uuid),
  core.can_access_class(uuid),
  core.can_access_student(uuid),
  core.can_access_book(uuid),
  content.can_report_problem(text),
  content.problem_public_payload(jsonb)
to authenticated, service_role;

revoke execute on function lms.reset_academy_data(uuid, text) from public;
revoke execute on function lms.reset_academy_data(uuid, text) from anon, authenticated;
grant execute on function lms.reset_academy_data(uuid, text) to service_role;

grant select, insert, update, delete on all tables in schema core to authenticated;
grant select on content.books, content.units, content.concepts, content.problem_types, content.assets, content.problem_reports to authenticated;
grant select on content.student_problems to authenticated;
grant select (
  id,
  book_id,
  unit_id,
  concept_id,
  problem_type_id,
  page_printed,
  number,
  image_path,
  public_payload,
  position_in_type,
  is_example,
  difficulty_hint,
  verified,
  created_at,
  updated_at
) on content.problems to authenticated;
grant insert, update, delete on content.books to authenticated;
grant insert, update, delete on content.problems to authenticated;
grant insert, update, delete on content.problem_reports to authenticated;
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
alter default privileges in schema lms grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema learning grant select on tables to authenticated;
alter default privileges in schema ai grant select on tables to authenticated;
alter default privileges in schema data grant select, insert on tables to authenticated;
alter default privileges in schema reporting grant select on tables to authenticated;
alter default privileges in schema core, content, learning, lms, ai, data, reporting, audit grant all on tables to service_role;
