-- Learning evidence v1: canonical analysis taxonomy, evidence classification,
-- class plans, teacher interventions, and immutable reporting snapshots.

-- ---------------------------------------------------------------------------
-- Canonical analysis taxonomy

create table content.analysis_taxonomy_revisions (
  id               uuid primary key default gen_random_uuid(),
  revision_number  integer not null unique check (revision_number > 0),
  status           text not null default 'draft'
                   check (status in ('draft', 'published', 'retired')),
  summary          text,
  published_at     timestamptz,
  created_by       uuid references core.people (id) on delete set null,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (status = 'draft' or published_at is not null)
);

create table content.analysis_skills (
  id                    uuid primary key default gen_random_uuid(),
  taxonomy_revision_id  uuid not null references content.analysis_taxonomy_revisions (id) on delete restrict,
  code                  text not null,
  subject               text not null,
  school_type           text check (school_type in ('elementary', 'middle', 'high') or school_type is null),
  grade                 text,
  semester              smallint check (semester between 1 and 2 or semester is null),
  unit_code             text,
  unit_name             text not null,
  name                  text not null,
  active                boolean not null default true,
  sort_order            integer not null default 0,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (btrim(code) <> ''),
  check (btrim(subject) <> ''),
  check (btrim(unit_name) <> ''),
  check (btrim(name) <> ''),
  unique (taxonomy_revision_id, code)
);

create table content.analysis_skill_aliases (
  id                 uuid primary key default gen_random_uuid(),
  academy_id         uuid not null references core.academies (id) on delete cascade,
  analysis_skill_id  uuid not null references content.analysis_skills (id) on delete cascade,
  alias_kind         text not null default 'display'
                     check (alias_kind in ('display', 'search')),
  alias_name         text not null,
  created_by         uuid references core.people (id) on delete set null,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (btrim(alias_name) <> '')
);

create unique index content_analysis_skill_aliases_name_key
  on content.analysis_skill_aliases (academy_id, analysis_skill_id, alias_kind, lower(alias_name));

create unique index content_analysis_skill_aliases_display_key
  on content.analysis_skill_aliases (academy_id, analysis_skill_id)
  where alias_kind = 'display';

create table content.problem_analysis_tags (
  problem_id            text not null references content.problems (id) on delete restrict,
  analysis_skill_id     uuid not null references content.analysis_skills (id) on delete restrict,
  taxonomy_revision_id  uuid not null references content.analysis_taxonomy_revisions (id) on delete restrict,
  challenge_band        smallint check (challenge_band between 1 and 4 or challenge_band is null),
  equivalence_key       text,
  source_kind           text not null default 'manual'
                        check (source_kind in ('manual', 'import', 'inferred', 'legacy')),
  source_ref            text,
  confidence            numeric(4, 3) check (confidence between 0 and 1 or confidence is null),
  review_status         text not null default 'pending'
                        check (review_status in ('pending', 'approved', 'rejected')),
  reviewed_by           uuid references core.people (id) on delete set null,
  reviewed_at           timestamptz,
  last_changed_by       uuid references core.people (id) on delete set null,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  primary key (problem_id, taxonomy_revision_id),
  check (equivalence_key is null or btrim(equivalence_key) <> ''),
  check (review_status = 'pending' or reviewed_at is not null),
  check (
    review_status <> 'approved'
    or (challenge_band is not null and equivalence_key is not null)
  )
);

create table content.problem_analysis_tag_audit (
  id           bigint generated always as identity primary key,
  problem_id   text not null,
  operation    text not null check (operation in ('insert', 'update', 'delete')),
  old_tag      jsonb,
  new_tag      jsonb,
  changed_by   uuid references core.people (id) on delete set null,
  reason       text,
  changed_at   timestamptz not null default now(),
  check (
    (operation = 'insert' and old_tag is null and new_tag is not null)
    or (operation = 'update' and old_tag is not null and new_tag is not null)
    or (operation = 'delete' and old_tag is not null and new_tag is null)
  )
);

create or replace function content.capture_problem_analysis_tag_audit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid;
  v_reason text;
begin
  if tg_op = 'DELETE' then
    v_actor := old.last_changed_by;
    v_reason := nullif(old.metadata ->> 'change_reason', '');
    insert into content.problem_analysis_tag_audit (
      problem_id, operation, old_tag, new_tag, changed_by, reason
    ) values (
      old.problem_id, 'delete', to_jsonb(old), null, v_actor, v_reason
    );
    return old;
  end if;

  v_actor := coalesce(new.last_changed_by, new.reviewed_by);
  v_reason := nullif(new.metadata ->> 'change_reason', '');

  if tg_op = 'INSERT' then
    insert into content.problem_analysis_tag_audit (
      problem_id, operation, old_tag, new_tag, changed_by, reason
    ) values (
      new.problem_id, 'insert', null, to_jsonb(new), v_actor, v_reason
    );
  else
    insert into content.problem_analysis_tag_audit (
      problem_id, operation, old_tag, new_tag, changed_by, reason
    ) values (
      new.problem_id, 'update', to_jsonb(old), to_jsonb(new), v_actor, v_reason
    );
  end if;

  return new;
end;
$$;

create or replace function private.enforce_problem_analysis_tag_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_skill_revision_id uuid;
  v_revision_status text;
begin
  select skill.taxonomy_revision_id
  into v_skill_revision_id
  from content.analysis_skills skill
  where skill.id = new.analysis_skill_id;

  if v_skill_revision_id is null
     or v_skill_revision_id is distinct from new.taxonomy_revision_id then
    raise exception using
      errcode = '23514',
      message = 'Problem tag taxonomy revision must match its analysis skill.';
  end if;

  select revision.status
  into v_revision_status
  from content.analysis_taxonomy_revisions revision
  where revision.id = new.taxonomy_revision_id;

  if new.review_status = 'approved' and v_revision_status <> 'published' then
    raise exception using
      errcode = '23514',
      message = 'Only tags in a published taxonomy revision may be approved.';
  end if;

  return new;
end;
$$;

create trigger enforce_problem_analysis_tag_revision
  before insert or update of analysis_skill_id, taxonomy_revision_id, review_status
  on content.problem_analysis_tags
  for each row execute function private.enforce_problem_analysis_tag_revision();

create trigger capture_problem_analysis_tag_audit
  after insert or update or delete on content.problem_analysis_tags
  for each row execute function content.capture_problem_analysis_tag_audit();

create trigger set_analysis_taxonomy_revisions_updated_at
  before update on content.analysis_taxonomy_revisions
  for each row execute function core.set_updated_at();

create trigger set_analysis_skills_updated_at
  before update on content.analysis_skills
  for each row execute function core.set_updated_at();

create trigger set_analysis_skill_aliases_updated_at
  before update on content.analysis_skill_aliases
  for each row execute function core.set_updated_at();

create trigger set_problem_analysis_tags_updated_at
  before update on content.problem_analysis_tags
  for each row execute function core.set_updated_at();

-- ---------------------------------------------------------------------------
-- Attempt evidence contract and idempotent session keys

alter table learning.sessions
  add column if not exists client_submission_id uuid;

alter table learning.attempts
  add column if not exists response_state text not null default 'answered',
  add column if not exists evidence_kind text not null default 'legacy_ambiguous',
  add column if not exists analysis_eligible boolean not null default false,
  add column if not exists exclusion_reason text,
  add column if not exists evidence_policy_version integer not null default 1,
  add column if not exists submitted_at timestamptz;

update learning.attempts attempt
set submitted_at = coalesce(session.submitted_at, attempt.created_at)
from learning.sessions session
where session.id = attempt.session_id
  and attempt.submitted_at is null;

update learning.attempts
set submitted_at = created_at
where submitted_at is null;

update learning.attempts
set exclusion_reason = 'legacy_context_unknown'
where not analysis_eligible
  and exclusion_reason is null;

alter table learning.attempts
  alter column submitted_at set default now(),
  alter column submitted_at set not null;

do $$
begin
  if exists (select 1 from learning.attempts where attempt_no <= 0) then
    raise exception using
      errcode = '23514',
      message = 'learning.attempts contains attempt_no <= 0; repair those rows before applying learning evidence v1.';
  end if;

  if exists (select 1 from learning.attempts where duration_ms < 0) then
    raise exception using
      errcode = '23514',
      message = 'learning.attempts contains duration_ms < 0; repair those rows before applying learning evidence v1.';
  end if;

  if exists (
    select 1
    from learning.attempts
    group by session_id, problem_id, coalesce(sub_label, '')
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'learning.attempts contains duplicate session/problem/sub-label rows; deduplicate before applying learning evidence v1.';
  end if;

  if exists (
    select 1
    from learning.attempts
    group by core_student_id, problem_id, coalesce(sub_label, ''), attempt_no
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'learning.attempts contains duplicate student/problem/sub-label/attempt_no rows; repair attempt numbering before applying learning evidence v1.';
  end if;

  if exists (
    select 1
    from learning.sessions
    where assignment_id is not null
    group by core_student_id, assignment_id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'learning.sessions contains multiple sessions for one student and assignment; reconcile submissions before applying learning evidence v1.';
  end if;

  if exists (
    select 1
    from learning.attempts attempt
    join learning.sessions session on session.id = attempt.session_id
    where attempt.academy_id is distinct from session.academy_id
       or attempt.core_student_id is distinct from session.core_student_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'learning.attempts contains academy/student values inconsistent with its session; repair rows before applying learning evidence v1.';
  end if;
end;
$$;

alter table learning.attempts
  add constraint learning_attempts_attempt_no_positive_check
    check (attempt_no > 0),
  add constraint learning_attempts_duration_nonnegative_check
    check (duration_ms is null or duration_ms >= 0),
  add constraint learning_attempts_response_state_check
    check (response_state in ('answered', 'unknown', 'blank')),
  add constraint learning_attempts_evidence_kind_check
    check (evidence_kind in (
      'independent_new',
      'independent_same_delayed',
      'correction',
      'review',
      'guided',
      'legacy_qualified',
      'legacy_ambiguous'
    )),
  add constraint learning_attempts_evidence_policy_version_check
    check (evidence_policy_version > 0),
  add constraint learning_attempts_response_semantics_check
    check (
      response_state = 'answered'
      or (response_state = 'unknown' and correct = false and unsure = true)
      or (response_state = 'blank' and correct = false and unsure = false)
    ),
  add constraint learning_attempts_evidence_eligibility_check
    check (
      (
        analysis_eligible
        and response_state <> 'blank'
        and evidence_kind not in ('correction', 'review', 'guided', 'legacy_ambiguous')
        and exclusion_reason is null
      )
      or (
        not analysis_eligible
        and exclusion_reason is not null
      )
    );

alter table learning.sessions
  add constraint learning_sessions_identity_key
  unique (id, academy_id, core_student_id);

alter table learning.attempts
  add constraint learning_attempts_session_identity_fkey
  foreign key (session_id, academy_id, core_student_id)
  references learning.sessions (id, academy_id, core_student_id)
  on delete cascade;

create unique index learning_sessions_student_client_submission_key
  on learning.sessions (core_student_id, client_submission_id)
  where client_submission_id is not null;

create unique index learning_sessions_student_assignment_key
  on learning.sessions (core_student_id, assignment_id)
  where assignment_id is not null;

create unique index learning_attempts_session_problem_sub_key
  on learning.attempts (session_id, problem_id, coalesce(sub_label, ''));

create unique index learning_attempts_student_problem_sub_number_key
  on learning.attempts (core_student_id, problem_id, coalesce(sub_label, ''), attempt_no);

create index learning_attempts_evidence_student_time_idx
  on learning.attempts (academy_id, core_student_id, submitted_at desc, id desc)
  where analysis_eligible;

-- ---------------------------------------------------------------------------
-- Study-track and exam plans

create table learning.analysis_plans (
  id                         uuid primary key default gen_random_uuid(),
  academy_id                 uuid not null references core.academies (id) on delete cascade,
  class_id                   uuid not null references core.classes (id) on delete cascade,
  plan_type                  text not null check (plan_type in ('study_track', 'exam')),
  name                       text not null,
  status                     text not null default 'draft'
                             check (status in ('draft', 'active', 'archived')),
  target_challenge_band      smallint not null default 2
                             check (target_challenge_band between 1 and 4),
  maintenance_interval_days smallint,
  exam_date                  date,
  recheck_interval_days      smallint,
  starts_on                  date not null default current_date,
  ends_on                    date,
  taxonomy_revision_id       uuid not null references content.analysis_taxonomy_revisions (id) on delete restrict,
  created_by                 uuid references core.people (id) on delete set null,
  updated_by                 uuid references core.people (id) on delete set null,
  metadata                   jsonb not null default '{}'::jsonb,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  check (btrim(name) <> ''),
  check (ends_on is null or ends_on >= starts_on),
  check (
    (
      plan_type = 'study_track'
      and exam_date is null
      and maintenance_interval_days in (7, 14, 21, 30)
      and recheck_interval_days is null
    )
    or (
      plan_type = 'exam'
      and exam_date is not null
      and exam_date >= starts_on
      and maintenance_interval_days is null
      and recheck_interval_days between 1 and 90
    )
  )
);

create table learning.analysis_plan_scope (
  plan_id                 uuid not null references learning.analysis_plans (id) on delete cascade,
  analysis_skill_id       uuid not null references content.analysis_skills (id) on delete restrict,
  required                boolean not null default true,
  target_challenge_band   smallint check (target_challenge_band between 1 and 4 or target_challenge_band is null),
  sort_order              integer not null default 0,
  metadata                jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  primary key (plan_id, analysis_skill_id)
);

create table learning.analysis_plan_materials (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid not null references learning.analysis_plans (id) on delete cascade,
  material_type  text not null check (material_type in ('book', 'worksheet', 'problem_bank', 'external')),
  book_id        uuid references content.books (id) on delete set null,
  label          text not null,
  source_ref     text,
  active_from    date,
  active_to      date,
  created_by     uuid references core.people (id) on delete set null,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (btrim(label) <> ''),
  check (source_ref is null or btrim(source_ref) <> ''),
  check (active_to is null or active_from is null or active_to >= active_from),
  check (material_type <> 'book' or book_id is not null)
);

create table learning.analysis_plan_student_overrides (
  plan_id                    uuid not null references learning.analysis_plans (id) on delete cascade,
  student_id                 uuid not null references core.students (id) on delete cascade,
  included                   boolean not null default true,
  target_challenge_band      smallint check (target_challenge_band between 1 and 4 or target_challenge_band is null),
  maintenance_interval_days smallint check (maintenance_interval_days in (7, 14, 21, 30) or maintenance_interval_days is null),
  recheck_interval_days      smallint check (recheck_interval_days between 1 and 90 or recheck_interval_days is null),
  note                       text,
  updated_by                 uuid references core.people (id) on delete set null,
  metadata                   jsonb not null default '{}'::jsonb,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  primary key (plan_id, student_id)
);

create table learning.teacher_observations (
  id                 uuid primary key default gen_random_uuid(),
  academy_id         uuid not null references core.academies (id) on delete cascade,
  class_id           uuid not null references core.classes (id) on delete cascade,
  plan_id            uuid references learning.analysis_plans (id) on delete set null,
  student_id         uuid not null references core.students (id) on delete cascade,
  analysis_skill_id  uuid not null references content.analysis_skills (id) on delete restrict,
  observation_kind   text not null
                     check (observation_kind in ('observed_success', 'observed_difficulty', 'note')),
  note               text,
  observed_at        timestamptz not null default now(),
  created_by         uuid references core.people (id) on delete set null,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (observation_kind <> 'note' or (note is not null and btrim(note) <> ''))
);

create table learning.analysis_action_overrides (
  id                 uuid primary key default gen_random_uuid(),
  academy_id         uuid not null references core.academies (id) on delete cascade,
  class_id           uuid not null references core.classes (id) on delete cascade,
  plan_id            uuid references learning.analysis_plans (id) on delete set null,
  student_id         uuid not null references core.students (id) on delete cascade,
  analysis_skill_id  uuid not null references content.analysis_skills (id) on delete restrict,
  problem_id         text references content.problems (id) on delete set null,
  override_type      text not null check (override_type in (
    'snooze',
    'dismiss',
    'confirm_support',
    'problem_error',
    'exclude_context',
    'schedule_recheck'
  )),
  reason             text,
  review_on          date,
  expires_at         timestamptz,
  active             boolean not null default true,
  created_by         uuid references core.people (id) on delete set null,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (override_type not in ('problem_error', 'exclude_context') or problem_id is not null),
  check (override_type <> 'schedule_recheck' or review_on is not null)
);

create table learning.analysis_report_snapshots (
  id                       uuid primary key default gen_random_uuid(),
  academy_id               uuid not null references core.academies (id) on delete cascade,
  class_id                 uuid not null references core.classes (id) on delete cascade,
  plan_id                  uuid references learning.analysis_plans (id) on delete set null,
  student_id               uuid references core.students (id) on delete cascade,
  snapshot_kind            text not null check (snapshot_kind in ('student', 'class', 'exam')),
  title                    text not null,
  period_start             date,
  period_end               date,
  taxonomy_revision_id     uuid not null references content.analysis_taxonomy_revisions (id) on delete restrict,
  evidence_policy_version  integer not null check (evidence_policy_version > 0),
  payload                  jsonb not null,
  published_at             timestamptz not null default now(),
  created_by               uuid references core.people (id) on delete set null,
  metadata                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  check (btrim(title) <> ''),
  check (period_end is null or period_start is null or period_end >= period_start),
  check (snapshot_kind <> 'student' or student_id is not null)
);

-- Validate cross-table academy/class/student relationships even for trusted
-- service-role writes. RLS alone is not a data-integrity constraint.
create or replace function private.enforce_analysis_plan_context()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_class_academy_id uuid;
  v_revision_status text;
begin
  select class.academy_id
  into v_class_academy_id
  from core.classes class
  where class.id = new.class_id;

  if v_class_academy_id is null or v_class_academy_id <> new.academy_id then
    raise exception using
      errcode = '23514',
      message = 'Analysis plan class does not belong to the supplied academy.';
  end if;

  if new.status = 'active' then
    select revision.status
    into v_revision_status
    from content.analysis_taxonomy_revisions revision
    where revision.id = new.taxonomy_revision_id;

    if v_revision_status <> 'published' then
      raise exception using
        errcode = '23514',
        message = 'Active analysis plans require a published taxonomy revision.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.enforce_analysis_child_context()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row                 jsonb := to_jsonb(new);
  v_academy_id          uuid := nullif(v_row ->> 'academy_id', '')::uuid;
  v_class_id            uuid := nullif(v_row ->> 'class_id', '')::uuid;
  v_plan_id             uuid := nullif(v_row ->> 'plan_id', '')::uuid;
  v_student_id          uuid := nullif(v_row ->> 'student_id', '')::uuid;
  v_book_id             uuid := nullif(v_row ->> 'book_id', '')::uuid;
  v_analysis_skill_id   uuid := nullif(v_row ->> 'analysis_skill_id', '')::uuid;
  v_taxonomy_revision_id uuid := nullif(v_row ->> 'taxonomy_revision_id', '')::uuid;
  v_plan_academy_id     uuid;
  v_plan_class_id       uuid;
  v_plan_revision_id    uuid;
  v_skill_revision_id   uuid;
  v_related_academy_id  uuid;
begin
  if v_plan_id is not null then
    select plan.academy_id, plan.class_id, plan.taxonomy_revision_id
    into v_plan_academy_id, v_plan_class_id, v_plan_revision_id
    from learning.analysis_plans plan
    where plan.id = v_plan_id;

    if v_plan_academy_id is null then
      raise exception using errcode = '23503', message = 'Referenced analysis plan does not exist or is not accessible.';
    end if;

    if v_academy_id is not null and v_academy_id <> v_plan_academy_id then
      raise exception using errcode = '23514', message = 'Analysis child academy does not match its plan.';
    end if;

    if v_class_id is not null and v_class_id <> v_plan_class_id then
      raise exception using errcode = '23514', message = 'Analysis child class does not match its plan.';
    end if;

    if v_taxonomy_revision_id is not null
       and v_taxonomy_revision_id <> v_plan_revision_id then
      raise exception using errcode = '23514', message = 'Analysis child taxonomy revision does not match its plan.';
    end if;

    v_academy_id := coalesce(v_academy_id, v_plan_academy_id);
    v_class_id := coalesce(v_class_id, v_plan_class_id);
  end if;

  if v_analysis_skill_id is not null then
    select skill.taxonomy_revision_id
    into v_skill_revision_id
    from content.analysis_skills skill
    where skill.id = v_analysis_skill_id;

    if v_skill_revision_id is null then
      raise exception using errcode = '23503', message = 'Referenced analysis skill does not exist or is not accessible.';
    end if;

    if v_plan_revision_id is not null and v_skill_revision_id <> v_plan_revision_id then
      raise exception using errcode = '23514', message = 'Analysis child skill revision does not match its plan.';
    end if;

    if v_taxonomy_revision_id is not null and v_skill_revision_id <> v_taxonomy_revision_id then
      raise exception using errcode = '23514', message = 'Analysis child skill revision does not match its taxonomy revision.';
    end if;
  end if;

  if v_class_id is not null then
    select class.academy_id
    into v_related_academy_id
    from core.classes class
    where class.id = v_class_id;

    if v_related_academy_id is null
       or (v_academy_id is not null and v_related_academy_id <> v_academy_id) then
      raise exception using errcode = '23514', message = 'Analysis child class does not belong to its academy.';
    end if;

    v_academy_id := coalesce(v_academy_id, v_related_academy_id);
  end if;

  if v_student_id is not null then
    select student.academy_id
    into v_related_academy_id
    from core.students student
    where student.id = v_student_id;

    if v_related_academy_id is null
       or (v_academy_id is not null and v_related_academy_id <> v_academy_id) then
      raise exception using errcode = '23514', message = 'Analysis child student does not belong to its academy.';
    end if;

    if v_class_id is not null and not exists (
      select 1
      from core.class_students enrollment
      where enrollment.class_id = v_class_id
        and enrollment.student_id = v_student_id
        and enrollment.status = 'active'
    ) then
      raise exception using errcode = '23514', message = 'Analysis child student has no enrollment record in its class.';
    end if;
  end if;

  if v_book_id is not null then
    select book.academy_id
    into v_related_academy_id
    from content.books book
    where book.id = v_book_id;

    if not found then
      raise exception using errcode = '23503', message = 'Referenced analysis material book does not exist or is not accessible.';
    end if;

    if v_related_academy_id is not null
       and v_academy_id is not null
       and v_related_academy_id <> v_academy_id then
      raise exception using errcode = '23514', message = 'Analysis material book belongs to another academy.';
    end if;
  end if;

  return new;
end;
$$;

create trigger enforce_analysis_plan_context
  before insert or update of academy_id, class_id, status, taxonomy_revision_id
  on learning.analysis_plans
  for each row execute function private.enforce_analysis_plan_context();

create trigger enforce_analysis_plan_scope_context
  before insert or update on learning.analysis_plan_scope
  for each row execute function private.enforce_analysis_child_context();

create trigger enforce_analysis_plan_material_context
  before insert or update on learning.analysis_plan_materials
  for each row execute function private.enforce_analysis_child_context();

create trigger enforce_analysis_plan_student_override_context
  before insert or update on learning.analysis_plan_student_overrides
  for each row execute function private.enforce_analysis_child_context();

create trigger enforce_teacher_observation_context
  before insert or update on learning.teacher_observations
  for each row execute function private.enforce_analysis_child_context();

create trigger enforce_analysis_action_override_context
  before insert or update on learning.analysis_action_overrides
  for each row execute function private.enforce_analysis_child_context();

create trigger enforce_analysis_report_snapshot_context
  before insert or update on learning.analysis_report_snapshots
  for each row execute function private.enforce_analysis_child_context();

create trigger set_analysis_plans_updated_at
  before update on learning.analysis_plans
  for each row execute function core.set_updated_at();

create trigger set_analysis_plan_materials_updated_at
  before update on learning.analysis_plan_materials
  for each row execute function core.set_updated_at();

create trigger set_analysis_plan_student_overrides_updated_at
  before update on learning.analysis_plan_student_overrides
  for each row execute function core.set_updated_at();

create trigger set_teacher_observations_updated_at
  before update on learning.teacher_observations
  for each row execute function core.set_updated_at();

create trigger set_analysis_action_overrides_updated_at
  before update on learning.analysis_action_overrides
  for each row execute function core.set_updated_at();

-- ---------------------------------------------------------------------------
-- Foreign-key and workload indexes

create index content_analysis_taxonomy_revisions_created_by_idx
  on content.analysis_taxonomy_revisions (created_by)
  where created_by is not null;
create index content_analysis_skills_revision_idx
  on content.analysis_skills (taxonomy_revision_id);
create index content_analysis_skill_aliases_academy_idx
  on content.analysis_skill_aliases (academy_id);
create index content_analysis_skill_aliases_skill_idx
  on content.analysis_skill_aliases (analysis_skill_id);
create index content_analysis_skill_aliases_created_by_idx
  on content.analysis_skill_aliases (created_by)
  where created_by is not null;
create index content_problem_analysis_tags_skill_idx
  on content.problem_analysis_tags (analysis_skill_id, challenge_band)
  where review_status = 'approved';
create index content_problem_analysis_tags_revision_idx
  on content.problem_analysis_tags (taxonomy_revision_id);
create index content_problem_analysis_tags_equivalence_idx
  on content.problem_analysis_tags (equivalence_key)
  where equivalence_key is not null and review_status = 'approved';
create index content_problem_analysis_tags_reviewed_by_idx
  on content.problem_analysis_tags (reviewed_by)
  where reviewed_by is not null;
create index content_problem_analysis_tags_changed_by_idx
  on content.problem_analysis_tags (last_changed_by)
  where last_changed_by is not null;
create index content_problem_analysis_tag_audit_problem_time_idx
  on content.problem_analysis_tag_audit (problem_id, changed_at desc, id desc);
create index content_problem_analysis_tag_audit_changed_by_idx
  on content.problem_analysis_tag_audit (changed_by)
  where changed_by is not null;

create index learning_analysis_plans_academy_status_idx
  on learning.analysis_plans (academy_id, status, plan_type, created_at desc);
create index learning_analysis_plans_class_status_idx
  on learning.analysis_plans (class_id, status, plan_type);
create index learning_analysis_plans_revision_idx
  on learning.analysis_plans (taxonomy_revision_id);
create index learning_analysis_plans_created_by_idx
  on learning.analysis_plans (created_by)
  where created_by is not null;
create index learning_analysis_plans_updated_by_idx
  on learning.analysis_plans (updated_by)
  where updated_by is not null;
create index learning_analysis_plan_scope_skill_idx
  on learning.analysis_plan_scope (analysis_skill_id, plan_id);
create index learning_analysis_plan_materials_plan_idx
  on learning.analysis_plan_materials (plan_id, active_from, active_to);
create index learning_analysis_plan_materials_book_idx
  on learning.analysis_plan_materials (book_id)
  where book_id is not null;
create index learning_analysis_plan_materials_created_by_idx
  on learning.analysis_plan_materials (created_by)
  where created_by is not null;
create index learning_analysis_plan_student_overrides_student_idx
  on learning.analysis_plan_student_overrides (student_id, plan_id);
create index learning_analysis_plan_student_overrides_updated_by_idx
  on learning.analysis_plan_student_overrides (updated_by)
  where updated_by is not null;
create index learning_teacher_observations_class_time_idx
  on learning.teacher_observations (class_id, observed_at desc, id desc);
create index learning_teacher_observations_student_skill_time_idx
  on learning.teacher_observations (student_id, analysis_skill_id, observed_at desc);
create index learning_teacher_observations_plan_idx
  on learning.teacher_observations (plan_id)
  where plan_id is not null;
create index learning_teacher_observations_skill_idx
  on learning.teacher_observations (analysis_skill_id);
create index learning_teacher_observations_created_by_idx
  on learning.teacher_observations (created_by)
  where created_by is not null;
create index learning_analysis_action_overrides_active_queue_idx
  on learning.analysis_action_overrides (class_id, student_id, analysis_skill_id, review_on)
  where active;
create index learning_analysis_action_overrides_plan_idx
  on learning.analysis_action_overrides (plan_id)
  where plan_id is not null;
create index learning_analysis_action_overrides_problem_idx
  on learning.analysis_action_overrides (problem_id)
  where problem_id is not null;
create index learning_analysis_action_overrides_skill_idx
  on learning.analysis_action_overrides (analysis_skill_id);
create index learning_analysis_action_overrides_created_by_idx
  on learning.analysis_action_overrides (created_by)
  where created_by is not null;
create index learning_analysis_report_snapshots_class_time_idx
  on learning.analysis_report_snapshots (class_id, published_at desc, id desc);
create index learning_analysis_report_snapshots_plan_idx
  on learning.analysis_report_snapshots (plan_id)
  where plan_id is not null;
create index learning_analysis_report_snapshots_student_idx
  on learning.analysis_report_snapshots (student_id, published_at desc)
  where student_id is not null;
create index learning_analysis_report_snapshots_revision_idx
  on learning.analysis_report_snapshots (taxonomy_revision_id);
create index learning_analysis_report_snapshots_created_by_idx
  on learning.analysis_report_snapshots (created_by)
  where created_by is not null;

-- ---------------------------------------------------------------------------
-- Row-level security

alter table content.analysis_taxonomy_revisions enable row level security;
alter table content.analysis_skills enable row level security;
alter table content.analysis_skill_aliases enable row level security;
alter table content.problem_analysis_tags enable row level security;
alter table content.problem_analysis_tag_audit enable row level security;
alter table learning.analysis_plans enable row level security;
alter table learning.analysis_plan_scope enable row level security;
alter table learning.analysis_plan_materials enable row level security;
alter table learning.analysis_plan_student_overrides enable row level security;
alter table learning.teacher_observations enable row level security;
alter table learning.analysis_action_overrides enable row level security;
alter table learning.analysis_report_snapshots enable row level security;

create policy analysis_taxonomy_revisions_staff_select
  on content.analysis_taxonomy_revisions for select to authenticated
  using (exists (
    select 1
    from private.current_academy_ids(array['owner', 'admin', 'staff', 'teacher', 'instructor']) academy_id
  ));

create policy analysis_skills_staff_select
  on content.analysis_skills for select to authenticated
  using (exists (
    select 1
    from private.current_academy_ids(array['owner', 'admin', 'staff', 'teacher', 'instructor']) academy_id
  ));

create policy analysis_skill_aliases_staff_select
  on content.analysis_skill_aliases for select to authenticated
  using (academy_id in (
    select private.current_academy_ids(array['owner', 'admin', 'staff', 'teacher', 'instructor'])
  ));

create policy analysis_skill_aliases_admin_insert
  on content.analysis_skill_aliases for insert to authenticated
  with check (academy_id in (
    select private.current_academy_ids(array['owner', 'admin'])
  ));

create policy analysis_skill_aliases_admin_update
  on content.analysis_skill_aliases for update to authenticated
  using (academy_id in (
    select private.current_academy_ids(array['owner', 'admin'])
  ))
  with check (academy_id in (
    select private.current_academy_ids(array['owner', 'admin'])
  ));

create policy analysis_skill_aliases_admin_delete
  on content.analysis_skill_aliases for delete to authenticated
  using (academy_id in (
    select private.current_academy_ids(array['owner', 'admin'])
  ));

create policy problem_analysis_tags_staff_select
  on content.problem_analysis_tags for select to authenticated
  using (
    problem_id in (select private.accessible_problem_ids())
    and exists (
      select 1
      from private.current_academy_ids(array['owner', 'admin', 'staff', 'teacher', 'instructor']) academy_id
    )
  );

create policy problem_analysis_tag_audit_admin_select
  on content.problem_analysis_tag_audit for select to authenticated
  using (
    problem_id in (select private.accessible_problem_ids())
    and exists (
      select 1
      from private.current_academy_ids(array['owner', 'admin']) academy_id
    )
  );

create policy analysis_plans_staff_select
  on learning.analysis_plans for select to authenticated
  using (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (
      academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
      and class_id in (select private.current_assigned_class_ids())
    )
  );

create policy analysis_plans_staff_insert
  on learning.analysis_plans for insert to authenticated
  with check (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (
      academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
      and class_id in (select private.current_assigned_class_ids())
    )
  );

create policy analysis_plans_staff_update
  on learning.analysis_plans for update to authenticated
  using (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (
      academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
      and class_id in (select private.current_assigned_class_ids())
    )
  )
  with check (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (
      academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
      and class_id in (select private.current_assigned_class_ids())
    )
  );

create policy analysis_plans_staff_delete
  on learning.analysis_plans for delete to authenticated
  using (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (
      academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
      and class_id in (select private.current_assigned_class_ids())
    )
  );

create policy analysis_plan_scope_staff_select
  on learning.analysis_plan_scope for select to authenticated
  using (plan_id in (select id from learning.analysis_plans));
create policy analysis_plan_scope_staff_insert
  on learning.analysis_plan_scope for insert to authenticated
  with check (plan_id in (select id from learning.analysis_plans));
create policy analysis_plan_scope_staff_update
  on learning.analysis_plan_scope for update to authenticated
  using (plan_id in (select id from learning.analysis_plans))
  with check (plan_id in (select id from learning.analysis_plans));
create policy analysis_plan_scope_staff_delete
  on learning.analysis_plan_scope for delete to authenticated
  using (plan_id in (select id from learning.analysis_plans));

create policy analysis_plan_materials_staff_select
  on learning.analysis_plan_materials for select to authenticated
  using (plan_id in (select id from learning.analysis_plans));
create policy analysis_plan_materials_staff_insert
  on learning.analysis_plan_materials for insert to authenticated
  with check (plan_id in (select id from learning.analysis_plans));
create policy analysis_plan_materials_staff_update
  on learning.analysis_plan_materials for update to authenticated
  using (plan_id in (select id from learning.analysis_plans))
  with check (plan_id in (select id from learning.analysis_plans));
create policy analysis_plan_materials_staff_delete
  on learning.analysis_plan_materials for delete to authenticated
  using (plan_id in (select id from learning.analysis_plans));

create policy analysis_plan_student_overrides_staff_select
  on learning.analysis_plan_student_overrides for select to authenticated
  using (plan_id in (select id from learning.analysis_plans));
create policy analysis_plan_student_overrides_staff_insert
  on learning.analysis_plan_student_overrides for insert to authenticated
  with check (plan_id in (select id from learning.analysis_plans));
create policy analysis_plan_student_overrides_staff_update
  on learning.analysis_plan_student_overrides for update to authenticated
  using (plan_id in (select id from learning.analysis_plans))
  with check (plan_id in (select id from learning.analysis_plans));
create policy analysis_plan_student_overrides_staff_delete
  on learning.analysis_plan_student_overrides for delete to authenticated
  using (plan_id in (select id from learning.analysis_plans));

create policy teacher_observations_staff_select
  on learning.teacher_observations for select to authenticated
  using (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (
      academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
      and class_id in (select private.current_assigned_class_ids())
    )
  );
create policy teacher_observations_staff_insert
  on learning.teacher_observations for insert to authenticated
  with check (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (
      academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
      and class_id in (select private.current_assigned_class_ids())
    )
  );
create policy teacher_observations_staff_update
  on learning.teacher_observations for update to authenticated
  using (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (
      academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
      and class_id in (select private.current_assigned_class_ids())
    )
  )
  with check (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (
      academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
      and class_id in (select private.current_assigned_class_ids())
    )
  );
create policy teacher_observations_staff_delete
  on learning.teacher_observations for delete to authenticated
  using (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (
      academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
      and class_id in (select private.current_assigned_class_ids())
    )
  );

create policy analysis_action_overrides_staff_select
  on learning.analysis_action_overrides for select to authenticated
  using (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (
      academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
      and class_id in (select private.current_assigned_class_ids())
    )
  );
create policy analysis_action_overrides_staff_insert
  on learning.analysis_action_overrides for insert to authenticated
  with check (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (
      academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
      and class_id in (select private.current_assigned_class_ids())
    )
  );
create policy analysis_action_overrides_staff_update
  on learning.analysis_action_overrides for update to authenticated
  using (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (
      academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
      and class_id in (select private.current_assigned_class_ids())
    )
  )
  with check (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (
      academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
      and class_id in (select private.current_assigned_class_ids())
    )
  );
create policy analysis_action_overrides_staff_delete
  on learning.analysis_action_overrides for delete to authenticated
  using (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (
      academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
      and class_id in (select private.current_assigned_class_ids())
    )
  );

create policy analysis_report_snapshots_staff_select
  on learning.analysis_report_snapshots for select to authenticated
  using (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (
      academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
      and class_id in (select private.current_assigned_class_ids())
    )
  );
create policy analysis_report_snapshots_staff_insert
  on learning.analysis_report_snapshots for insert to authenticated
  with check (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (
      academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
      and class_id in (select private.current_assigned_class_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- Security-invoker reporting foundation

create view reporting.v_learning_evidence_base
with (security_invoker = true) as
select
  attempt.id as attempt_id,
  attempt.academy_id,
  attempt.session_id,
  attempt.assignment_id,
  attempt.core_student_id,
  attempt.problem_id,
  attempt.sub_label,
  attempt.correct,
  attempt.unsure,
  attempt.attempt_no,
  attempt.response_state,
  attempt.evidence_kind,
  attempt.analysis_eligible,
  attempt.exclusion_reason,
  attempt.evidence_policy_version,
  attempt.submitted_at,
  tag.analysis_skill_id,
  tag.taxonomy_revision_id,
  tag.challenge_band,
  tag.equivalence_key,
  skill.code as analysis_skill_code,
  skill.subject,
  skill.school_type,
  skill.grade,
  skill.semester,
  skill.unit_code,
  skill.unit_name,
  skill.name as analysis_skill_name
from learning.attempts attempt
join content.problem_analysis_tags tag
  on tag.problem_id = attempt.problem_id
 and tag.review_status = 'approved'
join content.analysis_skills skill
  on skill.id = tag.analysis_skill_id
 and skill.active;

-- ---------------------------------------------------------------------------
-- Explicit Data API privileges

revoke all on table
  content.analysis_taxonomy_revisions,
  content.analysis_skills,
  content.analysis_skill_aliases,
  content.problem_analysis_tags,
  content.problem_analysis_tag_audit,
  learning.analysis_plans,
  learning.analysis_plan_scope,
  learning.analysis_plan_materials,
  learning.analysis_plan_student_overrides,
  learning.teacher_observations,
  learning.analysis_action_overrides,
  learning.analysis_report_snapshots,
  reporting.v_learning_evidence_base
from public, anon, authenticated;

grant select on table
  content.analysis_taxonomy_revisions,
  content.analysis_skills,
  content.analysis_skill_aliases,
  content.problem_analysis_tags,
  content.problem_analysis_tag_audit,
  learning.analysis_plans,
  learning.analysis_plan_scope,
  learning.analysis_plan_materials,
  learning.analysis_plan_student_overrides,
  learning.teacher_observations,
  learning.analysis_action_overrides,
  learning.analysis_report_snapshots,
  reporting.v_learning_evidence_base
to authenticated;

grant insert, update, delete on table content.analysis_skill_aliases to authenticated;

grant insert, update, delete on table
  learning.teacher_observations,
  learning.analysis_action_overrides
to authenticated;

-- Plans and their children must be written atomically through
-- learning.create_analysis_plan_v1. RLS alone cannot prevent partial plans.
revoke insert, update, delete on table
  learning.analysis_plans,
  learning.analysis_plan_scope,
  learning.analysis_plan_materials,
  learning.analysis_plan_student_overrides
from authenticated;

grant insert on table learning.analysis_report_snapshots to authenticated;

grant all privileges on table
  content.analysis_taxonomy_revisions,
  content.analysis_skills,
  content.analysis_skill_aliases,
  content.problem_analysis_tags,
  content.problem_analysis_tag_audit,
  learning.analysis_plans,
  learning.analysis_plan_scope,
  learning.analysis_plan_materials,
  learning.analysis_plan_student_overrides,
  learning.teacher_observations,
  learning.analysis_action_overrides,
  learning.analysis_report_snapshots
to service_role;

grant select on table reporting.v_learning_evidence_base to service_role;
grant usage, select on sequence content.problem_analysis_tag_audit_id_seq to service_role;

revoke all on function content.capture_problem_analysis_tag_audit() from public, anon, authenticated;
revoke all on function private.enforce_problem_analysis_tag_revision() from public, anon, authenticated;
revoke all on function private.enforce_analysis_plan_context() from public, anon, authenticated;
revoke all on function private.enforce_analysis_child_context() from public, anon, authenticated;
grant execute on function content.capture_problem_analysis_tag_audit() to service_role;
grant execute on function private.enforce_problem_analysis_tag_revision() to service_role;
grant execute on function private.enforce_analysis_plan_context() to service_role;
grant execute on function private.enforce_analysis_child_context() to service_role;

-- Session/attempt writes are reserved for the trusted submit_session_v2 path.
revoke insert, update, delete on learning.sessions from authenticated;
revoke insert, update, delete on learning.attempts from authenticated;
