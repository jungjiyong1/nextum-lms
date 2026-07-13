-- StudyQ single-bank ingestion and PDF-code assignment matching.
-- All source/reference and import-audit tables remain service-only. Match
-- workflow tables are available only to academy operations staff through RLS.

-- ---------------------------------------------------------------------------
-- Catalog visibility and content contract corrections

update content.books
set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{visibility}', '"catalog"'::jsonb, true)
where not (coalesce(metadata, '{}'::jsonb) ? 'visibility');

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select constraint_row.conname
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'content.problem_types'::regclass
      and constraint_row.contype = 'u'
      and pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (book_id, name)'
  loop
    execute format(
      'alter table content.problem_types drop constraint %I',
      constraint_name
    );
  end loop;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'content.problem_types'::regclass
      and constraint_row.contype = 'u'
      and pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (book_id, unit_id, name)'
  ) then
    alter table content.problem_types
      add constraint problem_types_book_unit_name_key
      unique (book_id, unit_id, name);
  end if;
end;
$$;

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
      'generated_choice',
        case when answer ? 'generated_choice' then (answer->>'generated_choice')::boolean else null end,
      'self_grade',
        case
          when answer ? 'self_grade' then (answer->>'self_grade')::boolean
          else answer->>'type' = 'text'
        end,
      'subs',
        case
          when jsonb_typeof(answer->'subs') = 'array' then (
            select jsonb_agg(
              jsonb_strip_nulls(
                jsonb_build_object(
                  'label', sub->>'label',
                  'type', sub->>'type',
                  'choice_count',
                    case
                      when sub ? 'choice_count' then nullif(sub->>'choice_count', '')::int
                      when jsonb_typeof(sub->'choices') = 'array' then jsonb_array_length(sub->'choices')
                      else null
                    end,
                  'choices',
                    case when jsonb_typeof(sub->'choices') = 'array' then sub->'choices' end,
                  'options',
                    case
                      when jsonb_typeof(sub->'choices') = 'array' then sub->'choices'
                      when jsonb_typeof(sub->'distractors') = 'array' then sub->'distractors'
                      else null
                    end,
                  'multiple',
                    case when sub ? 'multiple' then (sub->>'multiple')::boolean else null end,
                  'generated_choice',
                    case when sub ? 'generated_choice' then (sub->>'generated_choice')::boolean else null end,
                  'self_grade',
                    case
                      when sub ? 'self_grade' then (sub->>'self_grade')::boolean
                      else sub->>'type' = 'text'
                    end
                )
              )
              order by ordinality
            )
            from jsonb_array_elements(answer->'subs') with ordinality as source(sub, ordinality)
          )
          else null
        end
    )
  )
$$;

update content.problems
set public_payload = content.problem_public_payload(answer),
    updated_at = now()
where jsonb_typeof(answer->'subs') = 'array'
  and jsonb_array_length(answer->'subs') > 0;

-- ---------------------------------------------------------------------------
-- Service-only source identity and import audit

create table content.problem_source_refs (
  academy_id          uuid not null references core.academies (id) on delete cascade,
  source_namespace    text not null,
  external_id         text not null,
  problem_id          text not null references content.problems (id) on delete restrict,
  source_file_name    text,
  source_file_sha256  text not null,
  source_page         integer,
  bbox                jsonb,
  content_sha256      text not null,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (academy_id, source_namespace, external_id),
  check (btrim(source_namespace) <> ''),
  check (btrim(external_id) <> ''),
  check (source_namespace <> 'studyq' or external_id ~ '^[0-9]{7}$'),
  check (source_file_sha256 ~ '^[0-9a-f]{64}$'),
  check (content_sha256 ~ '^[0-9a-f]{64}$'),
  check (source_page is null or source_page > 0),
  check (bbox is null or jsonb_typeof(bbox) in ('array', 'object')),
  check (jsonb_typeof(metadata) = 'object')
);

create index content_problem_source_refs_problem_idx
  on content.problem_source_refs (problem_id);
create index content_problem_source_refs_namespace_external_idx
  on content.problem_source_refs (source_namespace, external_id);

create table content.import_runs (
  id                 uuid primary key default gen_random_uuid(),
  academy_id         uuid not null references core.academies (id) on delete cascade,
  book_id            uuid not null references content.books (id) on delete restrict,
  bundle_version     text not null,
  bundle_sha256      text not null,
  pipeline_version   text not null,
  import_mode        text not null check (import_mode in ('initial', 'incremental')),
  bundle_problem_count integer not null check (bundle_problem_count > 0),
  expected_bank_problem_count integer not null check (expected_bank_problem_count > 0),
  publish_requested  boolean not null default false,
  asset_bucket       text not null default 'problem-images',
  status             text not null default 'running'
                     check (status in ('running', 'succeeded', 'failed')),
  approved_by        text not null,
  approved_at        timestamptz not null,
  approval_sha256    text not null,
  execution_sha      text not null,
  source_path        text,
  stats              jsonb not null default '{}'::jsonb,
  error_message      text,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (academy_id, bundle_sha256),
  check (bundle_version = 'studyq-bank-bundle-v2'),
  check (bundle_sha256 ~ '^[0-9a-f]{64}$'),
  check (approval_sha256 ~ '^[0-9a-f]{64}$'),
  check (btrim(pipeline_version) <> ''),
  check (btrim(asset_bucket) <> ''),
  check (btrim(execution_sha) <> ''),
  check (btrim(approved_by) <> ''),
  check (jsonb_typeof(stats) = 'object'),
  check ((status = 'running' and finished_at is null) or status <> 'running')
);

-- Staging is intentionally service-only. Uploading a bundle may take many HTTP
-- requests, but none of these rows are student-visible canonical content. The
-- commit RPC below consumes them under one bank advisory lock and one database
-- transaction.
create table content.studyq_import_stage_problems (
  import_run_id  uuid not null references content.import_runs (id) on delete cascade,
  external_id   text not null,
  problem_id    text not null,
  content_sha256 text not null,
  payload       jsonb not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (import_run_id, external_id),
  unique (import_run_id, problem_id),
  check (external_id ~ '^[0-9]{7}$'),
  check (content_sha256 ~ '^[0-9a-f]{64}$'),
  check (jsonb_typeof(payload) = 'object')
);

create table content.studyq_import_stage_skills (
  import_run_id uuid not null references content.import_runs (id) on delete cascade,
  code          text not null,
  skill_id      uuid not null,
  payload       jsonb not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (import_run_id, code),
  unique (import_run_id, skill_id),
  check (btrim(code) <> ''),
  check (jsonb_typeof(payload) = 'object')
);

create table content.studyq_import_attempts (
  id             uuid primary key,
  import_run_id  uuid not null references content.import_runs (id) on delete cascade,
  status         text not null default 'running'
                 check (status in (
                   'running', 'committed', 'failed', 'cleanup_pending',
                   'cleaned', 'cleanup_failed'
                 )),
  stats          jsonb not null default '{}'::jsonb,
  error_message  text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (jsonb_typeof(stats) = 'object')
);

create table content.studyq_import_attempt_assets (
  attempt_id          uuid not null references content.studyq_import_attempts (id) on delete cascade,
  asset_bucket        text not null,
  storage_path        text not null,
  existed_before      boolean not null,
  upload_status       text not null
                      check (upload_status in (
                        'planned', 'uploaded', 'skipped_existing', 'upload_failed'
                      )),
  cleanup_status      text not null
                      check (cleanup_status in (
                        'pending', 'not_needed', 'retained', 'claimed', 'deleted', 'failed'
                      )),
  cleanup_claimed_by  uuid references content.studyq_import_attempts (id) on delete set null,
  cleanup_error       text,
  uploaded_at         timestamptz,
  cleanup_claimed_at  timestamptz,
  deleted_at          timestamptz,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (attempt_id, storage_path),
  check (btrim(asset_bucket) <> ''),
  check (btrim(storage_path) <> ''),
  check (jsonb_typeof(metadata) = 'object'),
  check (
    (cleanup_status = 'claimed' and cleanup_claimed_by is not null and cleanup_claimed_at is not null)
    or cleanup_status <> 'claimed'
  )
);

create index content_studyq_import_attempts_run_status_idx
  on content.studyq_import_attempts (import_run_id, status, started_at);
create index content_studyq_import_attempt_assets_path_idx
  on content.studyq_import_attempt_assets (asset_bucket, storage_path, cleanup_status);
create index content_studyq_import_attempt_assets_retry_idx
  on content.studyq_import_attempt_assets (attempt_id, cleanup_status, storage_path)
  where not existed_before and cleanup_status in ('pending', 'retained', 'failed');

create index content_import_runs_book_time_idx
  on content.import_runs (book_id, started_at desc);
create index content_import_runs_status_idx
  on content.import_runs (status, started_at desc);

drop trigger if exists set_problem_source_refs_updated_at on content.problem_source_refs;
create trigger set_problem_source_refs_updated_at
  before update on content.problem_source_refs
  for each row execute function core.set_updated_at();

drop trigger if exists set_import_runs_updated_at on content.import_runs;
create trigger set_import_runs_updated_at
  before update on content.import_runs
  for each row execute function core.set_updated_at();

drop trigger if exists set_studyq_import_stage_problems_updated_at on content.studyq_import_stage_problems;
create trigger set_studyq_import_stage_problems_updated_at
  before update on content.studyq_import_stage_problems
  for each row execute function core.set_updated_at();

drop trigger if exists set_studyq_import_stage_skills_updated_at on content.studyq_import_stage_skills;
create trigger set_studyq_import_stage_skills_updated_at
  before update on content.studyq_import_stage_skills
  for each row execute function core.set_updated_at();

drop trigger if exists set_studyq_import_attempts_updated_at on content.studyq_import_attempts;
create trigger set_studyq_import_attempts_updated_at
  before update on content.studyq_import_attempts
  for each row execute function core.set_updated_at();

drop trigger if exists set_studyq_import_attempt_assets_updated_at on content.studyq_import_attempt_assets;
create trigger set_studyq_import_attempt_assets_updated_at
  before update on content.studyq_import_attempt_assets
  for each row execute function core.set_updated_at();

alter table content.problem_source_refs enable row level security;
alter table content.import_runs enable row level security;
alter table content.studyq_import_stage_problems enable row level security;
alter table content.studyq_import_stage_skills enable row level security;
alter table content.studyq_import_attempts enable row level security;
alter table content.studyq_import_attempt_assets enable row level security;

revoke all on table
  content.problem_source_refs,
  content.import_runs,
  content.studyq_import_stage_problems,
  content.studyq_import_stage_skills,
  content.studyq_import_attempts,
  content.studyq_import_attempt_assets
  from public, anon, authenticated;
grant all privileges on table
  content.problem_source_refs,
  content.import_runs,
  content.studyq_import_stage_problems,
  content.studyq_import_stage_skills,
  content.studyq_import_attempts,
  content.studyq_import_attempt_assets
  to service_role;

-- ---------------------------------------------------------------------------
-- PDF code-match workflow

create table learning.assignment_match_batches (
  id               uuid primary key default gen_random_uuid(),
  academy_id       uuid not null references core.academies (id) on delete cascade,
  mode             text not null default 'single' check (mode in ('single', 'batch')),
  status           text not null default 'draft'
                   check (status in (
                     'draft', 'processing', 'review_required', 'ready',
                     'partially_assigned', 'assigned', 'failed', 'cancelled', 'expired'
                   )),
  idempotency_key  text not null,
  created_by       uuid references core.people (id) on delete set null,
  metadata         jsonb not null default '{}'::jsonb,
  expires_at       timestamptz not null default (now() + interval '30 days'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (academy_id, idempotency_key),
  check (btrim(idempotency_key) <> '' and length(idempotency_key) <= 200),
  check (jsonb_typeof(metadata) = 'object')
);

create table learning.assignment_match_jobs (
  id                       uuid primary key default gen_random_uuid(),
  batch_id                 uuid not null references learning.assignment_match_batches (id) on delete cascade,
  academy_id               uuid not null references core.academies (id) on delete cascade,
  book_id                  uuid not null references content.books (id) on delete restrict,
  created_by               uuid references core.people (id) on delete set null,
  sort_order               integer not null default 0,
  target_student_id        uuid references core.students (id) on delete set null,
  file_name                text,
  file_path                text,
  media_type               text,
  file_size                bigint,
  page_count               integer,
  source_pdf_sha256        text,
  title                    text,
  description              text,
  context                  text not null default 'homework'
                           check (context in ('homework', 'free', 'retry', 'drill', 'diagnostic')),
  due_at                   timestamptz,
  available_from           timestamptz,
  status                   text not null default 'upload_pending'
                           check (status in (
                             'upload_pending', 'uploaded', 'processing', 'review_required',
                             'ready', 'publishing', 'assigned', 'failed', 'cancelled', 'expired'
                           )),
  revision                 integer not null default 1 check (revision > 0),
  assignment_id            uuid unique references learning.assignments (id) on delete set null,
  mutation_id              uuid,
  finalize_idempotency_key text,
  summary                  jsonb not null default '{}'::jsonb,
  error_message            text,
  metadata                 jsonb not null default '{}'::jsonb,
  finalized_at             timestamptz,
  source_deleted_at        timestamptz,
  expires_at               timestamptz not null default (now() + interval '30 days'),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (batch_id, sort_order),
  check (sort_order >= 0),
  check (file_size is null or file_size between 1 and 52428800),
  check (page_count is null or page_count between 1 and 200),
  check (source_pdf_sha256 is null or source_pdf_sha256 ~ '^[0-9a-f]{64}$'),
  check (media_type is null or media_type = 'application/pdf'),
  check (title is null or (btrim(title) <> '' and length(btrim(title)) <= 200)),
  check (available_from is null or due_at is null or due_at >= available_from),
  check (
    finalize_idempotency_key is null
    or (btrim(finalize_idempotency_key) <> '' and length(finalize_idempotency_key) <= 200)
  ),
  check (jsonb_typeof(summary) = 'object'),
  check (jsonb_typeof(metadata) = 'object')
);

create table learning.assignment_match_items (
  job_id            uuid not null references learning.assignment_match_jobs (id) on delete cascade,
  ordinal           integer not null,
  page_number       integer,
  bbox              jsonb,
  source_namespace  text not null default 'studyq',
  external_code     varchar(7),
  status            text not null default 'unknown'
                    check (status in ('matched', 'unknown', 'duplicate', 'unverified', 'blocked', 'invalid')),
  problem_id        text references content.problems (id) on delete restrict,
  match_method      text check (match_method in ('manifest', 'exact_code', 'manual') or match_method is null),
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (job_id, ordinal),
  check (ordinal >= 0),
  check (page_number is null or page_number > 0),
  check (bbox is null or jsonb_typeof(bbox) in ('array', 'object')),
  check (btrim(source_namespace) <> ''),
  check (external_code is null or external_code ~ '^[0-9]{7}$'),
  check (
    (status = 'matched' and external_code is not null and problem_id is not null and match_method is not null)
    or status <> 'matched'
  ),
  check (jsonb_typeof(metadata) = 'object')
);

create index learning_assignment_match_batches_academy_status_idx
  on learning.assignment_match_batches (academy_id, status, created_at desc);
create index learning_assignment_match_batches_created_by_idx
  on learning.assignment_match_batches (created_by)
  where created_by is not null;
create index learning_assignment_match_batches_expiry_idx
  on learning.assignment_match_batches (expires_at, id)
  where status not in ('assigned', 'cancelled', 'expired');
create index learning_assignment_match_jobs_batch_status_idx
  on learning.assignment_match_jobs (batch_id, status, sort_order);
create index learning_assignment_match_jobs_book_idx
  on learning.assignment_match_jobs (book_id);
create index learning_assignment_match_jobs_created_by_idx
  on learning.assignment_match_jobs (created_by)
  where created_by is not null;
create index learning_assignment_match_jobs_academy_student_idx
  on learning.assignment_match_jobs (academy_id, target_student_id, created_at desc)
  where target_student_id is not null;
create unique index learning_assignment_match_jobs_file_path_key
  on learning.assignment_match_jobs (file_path)
  where file_path is not null;
create unique index learning_assignment_match_jobs_finalize_key
  on learning.assignment_match_jobs (academy_id, finalize_idempotency_key)
  where finalize_idempotency_key is not null;
create index learning_assignment_match_jobs_expiry_idx
  on learning.assignment_match_jobs (expires_at, id)
  where assignment_id is null and status not in ('assigned', 'cancelled', 'expired');
create index learning_assignment_match_jobs_source_cleanup_idx
  on learning.assignment_match_jobs (expires_at, id)
  where status = 'expired' and source_deleted_at is null and file_path is not null;
create index learning_assignment_match_items_problem_idx
  on learning.assignment_match_items (problem_id)
  where problem_id is not null;
create index learning_assignment_match_items_code_idx
  on learning.assignment_match_items (source_namespace, external_code)
  where external_code is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'learning.assignment_files'::regclass
      and constraint_row.contype = 'u'
      and pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (assignment_id, storage_path)'
  ) then
    alter table learning.assignment_files
      add constraint assignment_files_assignment_storage_key
      unique (assignment_id, storage_path);
  end if;
end;
$$;

drop trigger if exists set_assignment_match_batches_updated_at on learning.assignment_match_batches;
create trigger set_assignment_match_batches_updated_at
  before update on learning.assignment_match_batches
  for each row execute function core.set_updated_at();

drop trigger if exists set_assignment_match_jobs_updated_at on learning.assignment_match_jobs;
create trigger set_assignment_match_jobs_updated_at
  before update on learning.assignment_match_jobs
  for each row execute function core.set_updated_at();

drop trigger if exists set_assignment_match_items_updated_at on learning.assignment_match_items;
create trigger set_assignment_match_items_updated_at
  before update on learning.assignment_match_items
  for each row execute function core.set_updated_at();

alter table learning.assignment_match_batches enable row level security;
alter table learning.assignment_match_jobs enable row level security;
alter table learning.assignment_match_items enable row level security;

create policy assignment_match_batches_staff_select
  on learning.assignment_match_batches for select to authenticated
  using (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));
create policy assignment_match_batches_instructor_select
  on learning.assignment_match_batches for select to authenticated
  using (
    created_by = core.current_person_id()
    and academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
  );
create policy assignment_match_batches_staff_insert
  on learning.assignment_match_batches for insert to authenticated
  with check (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));
create policy assignment_match_batches_staff_update
  on learning.assignment_match_batches for update to authenticated
  using (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])))
  with check (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));
create policy assignment_match_batches_staff_delete
  on learning.assignment_match_batches for delete to authenticated
  using (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    and status in ('draft', 'failed', 'cancelled', 'expired')
  );

create policy assignment_match_jobs_staff_select
  on learning.assignment_match_jobs for select to authenticated
  using (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));
create policy assignment_match_jobs_instructor_select
  on learning.assignment_match_jobs for select to authenticated
  using (
    created_by = core.current_person_id()
    and academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
  );
create policy assignment_match_jobs_staff_insert
  on learning.assignment_match_jobs for insert to authenticated
  with check (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    and exists (
      select 1
      from learning.assignment_match_batches batch
      where batch.id = assignment_match_jobs.batch_id
        and batch.academy_id = assignment_match_jobs.academy_id
    )
  );
create policy assignment_match_jobs_staff_update
  on learning.assignment_match_jobs for update to authenticated
  using (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])))
  with check (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    and exists (
      select 1
      from learning.assignment_match_batches batch
      where batch.id = assignment_match_jobs.batch_id
        and batch.academy_id = assignment_match_jobs.academy_id
    )
  );
create policy assignment_match_jobs_staff_delete
  on learning.assignment_match_jobs for delete to authenticated
  using (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    and status in ('upload_pending', 'failed', 'cancelled')
  );

create policy assignment_match_items_staff_select
  on learning.assignment_match_items for select to authenticated
  using (
    exists (
      select 1
      from learning.assignment_match_jobs job
      where job.id = job_id
        and job.academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    )
  );
create policy assignment_match_items_instructor_select
  on learning.assignment_match_items for select to authenticated
  using (
    exists (
      select 1
      from learning.assignment_match_jobs job
      where job.id = job_id
        and job.created_by = core.current_person_id()
        and job.academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
    )
  );
create policy assignment_match_items_staff_insert
  on learning.assignment_match_items for insert to authenticated
  with check (
    exists (
      select 1
      from learning.assignment_match_jobs job
      where job.id = job_id
        and job.academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
        and job.status not in ('publishing', 'assigned', 'cancelled')
    )
  );
create policy assignment_match_items_staff_update
  on learning.assignment_match_items for update to authenticated
  using (
    exists (
      select 1
      from learning.assignment_match_jobs job
      where job.id = job_id
        and job.academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
        and job.status not in ('publishing', 'assigned', 'cancelled')
    )
  )
  with check (
    exists (
      select 1
      from learning.assignment_match_jobs job
      where job.id = job_id
        and job.academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
        and job.status not in ('publishing', 'assigned', 'cancelled')
    )
  );
create policy assignment_match_items_staff_delete
  on learning.assignment_match_items for delete to authenticated
  using (
    exists (
      select 1
      from learning.assignment_match_jobs job
      where job.id = job_id
        and job.academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
        and job.status not in ('publishing', 'assigned', 'cancelled')
    )
  );

revoke all on table
  learning.assignment_match_batches,
  learning.assignment_match_jobs,
  learning.assignment_match_items
from public, anon;

grant select, insert, update, delete on table
  learning.assignment_match_batches,
  learning.assignment_match_jobs,
  learning.assignment_match_items
to authenticated;

grant all privileges on table
  learning.assignment_match_batches,
  learning.assignment_match_jobs,
  learning.assignment_match_items
to service_role;

-- Assignment attachments are immutable through the authenticated Data API.
-- Staff may create the row, while replacement/removal and match cleanup remain
-- server-side operations with an audit trail.
drop policy if exists learning_assignment_files_update on learning.assignment_files;
drop policy if exists learning_assignment_files_delete on learning.assignment_files;
revoke update, delete on table learning.assignment_files from authenticated;

-- ---------------------------------------------------------------------------
-- Private assignment PDF bucket. Direct object access is still RLS protected;
-- server-generated signed URLs remain the normal student read path.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assignment-files', 'assignment-files', false, 52428800, array['application/pdf']::text[])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists assignment_files_objects_select on storage.objects;
create policy assignment_files_objects_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'assignment-files'
    and (
      (
        split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        and case
          when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
            then split_part(name, '/', 1)::uuid
          else null
        end in (
          select private.current_academy_ids(array['owner', 'admin', 'staff'])
        )
      )
      or exists (
        select 1
        from learning.assignment_files assignment_file
        where assignment_file.storage_path = storage.objects.name
          and assignment_file.media_type = 'application/pdf'
          and assignment_file.metadata ->> 'student_visible' = 'true'
          and assignment_file.assignment_id in (select private.accessible_assignment_ids())
      )
    )
  );

drop policy if exists assignment_files_objects_insert on storage.objects;
create policy assignment_files_objects_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'assignment-files'
    and split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    and split_part(name, '/', 2) = 'match-jobs'
    and split_part(name, '/', 3) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    and split_part(name, '/', 4) = 'source.pdf'
    and case
      when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        then split_part(name, '/', 1)::uuid
      else null
    end in (
      select private.current_academy_ids(array['owner', 'admin', 'staff'])
    )
    and exists (
      select 1
      from learning.assignment_match_jobs job
      where job.id = case
              when split_part(storage.objects.name, '/', 3) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
                then split_part(storage.objects.name, '/', 3)::uuid
              else null
            end
        and job.academy_id = case
              when split_part(storage.objects.name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
                then split_part(storage.objects.name, '/', 1)::uuid
              else null
            end
        and job.file_path = storage.objects.name
        and job.status in ('upload_pending', 'uploaded', 'failed')
    )
  );

drop policy if exists assignment_files_objects_update on storage.objects;
drop policy if exists assignment_files_objects_delete on storage.objects;
-- Deliberately no authenticated UPDATE/DELETE policy: a matched PDF is
-- immutable after its one signed INSERT. Cleanup runs with service_role.

-- ---------------------------------------------------------------------------
-- Assignment mutation boundary: only catalog-visible, verified content.

create or replace function learning.create_assignment_v2(
  p_academy_id uuid,
  p_book_id uuid,
  p_title text,
  p_problem_ids text[],
  p_class_ids uuid[] default array[]::uuid[],
  p_student_ids uuid[] default array[]::uuid[],
  p_description text default null,
  p_context text default 'homework',
  p_due_at timestamptz default null,
  p_available_from timestamptz default null,
  p_metadata jsonb default '{}'::jsonb,
  p_excluded_student_ids uuid[] default array[]::uuid[],
  p_created_by uuid default null,
  p_source_type text default 'content_scope'
)
returns table (
  assignment_id uuid,
  item_count bigint,
  recipient_count bigint,
  mutation_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_problem_ids text[] := coalesce(p_problem_ids, array[]::text[]);
  v_class_ids uuid[] := coalesce(p_class_ids, array[]::uuid[]);
  v_student_ids uuid[] := coalesce(p_student_ids, array[]::uuid[]);
  v_excluded_student_ids uuid[] := coalesce(p_excluded_student_ids, array[]::uuid[]);
  v_assignment_id uuid;
  v_item_count bigint := 0;
  v_recipient_count bigint := 0;
  v_expected_count bigint;
  v_mutation_id uuid := gen_random_uuid();
  v_created_by uuid;
  v_actor_person_id uuid;
  v_unit_id uuid;
begin
  if current_user <> 'service_role'
     and p_academy_id not in (
       select private.current_academy_ids(array['owner', 'admin', 'staff'])
     ) then
    raise exception using errcode = '42501', message = 'Only academy operations staff may create assignments.';
  end if;

  if p_academy_id is null or p_book_id is null then
    raise exception using errcode = '22023', message = 'academy_id and book_id are required.';
  end if;
  if nullif(btrim(p_title), '') is null or length(btrim(p_title)) > 200 then
    raise exception using errcode = '22023', message = 'title must contain 1..200 characters.';
  end if;
  if p_context is null or p_context not in ('homework', 'free', 'retry', 'drill', 'diagnostic') then
    raise exception using errcode = '22023', message = 'Unsupported assignment context.';
  end if;
  if p_source_type is null or p_source_type not in ('content_scope', 'worksheet') then
    raise exception using errcode = '22023', message = 'source_type must be content_scope or worksheet.';
  end if;
  if p_available_from is not null and p_due_at is not null and p_due_at < p_available_from then
    raise exception using errcode = '22023', message = 'due_at must not precede available_from.';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception using errcode = '22023', message = 'metadata must be a JSON object.';
  end if;
  if cardinality(v_problem_ids) = 0 or cardinality(v_problem_ids) > 1000 then
    raise exception using errcode = '22023', message = 'Between 1 and 1000 problem IDs are required.';
  end if;
  if cardinality(v_class_ids) = 0 and cardinality(v_student_ids) = 0 then
    raise exception using errcode = '22023', message = 'At least one class or student target is required.';
  end if;
  if cardinality(v_class_ids) > 100
     or cardinality(v_student_ids) > 1000
     or cardinality(v_excluded_student_ids) > 5000 then
    raise exception using errcode = '22023', message = 'Target limits are 100 classes, 1000 direct students, and 5000 exclusions.';
  end if;
  if exists (select 1 from unnest(v_problem_ids) value where value is null)
     or exists (select 1 from unnest(v_class_ids) value where value is null)
     or exists (select 1 from unnest(v_student_ids) value where value is null)
     or exists (select 1 from unnest(v_excluded_student_ids) value where value is null) then
    raise exception using errcode = '22023', message = 'Target and problem arrays cannot contain nulls.';
  end if;
  if cardinality(v_problem_ids) <> (select count(distinct value) from unnest(v_problem_ids) value)
     or cardinality(v_class_ids) <> (select count(distinct value) from unnest(v_class_ids) value)
     or cardinality(v_student_ids) <> (select count(distinct value) from unnest(v_student_ids) value)
     or cardinality(v_excluded_student_ids) <> (select count(distinct value) from unnest(v_excluded_student_ids) value) then
    raise exception using errcode = '22023', message = 'Input arrays cannot contain duplicate IDs.';
  end if;

  if not exists (
    select 1
    from content.books b
    where b.id = p_book_id
      and (b.academy_id is null or b.academy_id = p_academy_id)
      and b.metadata->>'visibility' = 'catalog'
  ) then
    raise exception using errcode = '22023', message = 'The requested book is unavailable or not catalog-visible.';
  end if;

  select
    count(*),
    case
      when count(distinct p.unit_id) = 1 and count(p.unit_id) = count(*)
        then (array_agg(distinct p.unit_id) filter (where p.unit_id is not null))[1]
      else null
    end
  into v_expected_count, v_unit_id
  from content.problems p
  where p.id = any(v_problem_ids)
    and p.book_id = p_book_id
    and p.verified;
  if v_expected_count <> cardinality(v_problem_ids) then
    raise exception using errcode = '22023', message = 'Every problem must be verified and belong to the requested catalog book.';
  end if;

  select count(*) into v_expected_count
  from core.classes c
  where c.id = any(v_class_ids)
    and c.academy_id = p_academy_id
    and c.active;
  if v_expected_count <> cardinality(v_class_ids) then
    raise exception using errcode = '22023', message = 'Every class target must be active and belong to the academy.';
  end if;

  select count(*) into v_expected_count
  from core.students s
  where s.id = any(v_student_ids)
    and s.academy_id = p_academy_id
    and s.status = 'active';
  if v_expected_count <> cardinality(v_student_ids) then
    raise exception using errcode = '22023', message = 'Every student target must be active and belong to the academy.';
  end if;

  select count(*) into v_expected_count
  from core.students s
  where s.id = any(v_excluded_student_ids)
    and s.academy_id = p_academy_id;
  if v_expected_count <> cardinality(v_excluded_student_ids) then
    raise exception using errcode = '22023', message = 'Every excluded student must belong to the academy.';
  end if;

  select actor.person_id into v_actor_person_id
  from private.current_actor() actor;

  if current_user <> 'service_role'
     and p_created_by is not null
     and p_created_by is distinct from v_actor_person_id then
    raise exception using errcode = '42501', message = 'created_by must match the authenticated actor.';
  end if;

  v_created_by := case
    when current_user = 'service_role' then p_created_by
    else coalesce(p_created_by, v_actor_person_id)
  end;

  if v_created_by is not null and not exists (
    select 1
    from core.academy_members member
    where member.academy_id = p_academy_id
      and member.person_id = v_created_by
      and member.active
      and member.role in ('owner', 'admin', 'staff', 'teacher', 'instructor')
  ) then
    raise exception using errcode = '22023', message = 'created_by must be an active academy staff member.';
  end if;

  insert into learning.assignments (
    academy_id,
    book_id,
    unit_id,
    problem_id,
    title,
    description,
    context,
    due_at,
    created_by,
    active,
    source_type,
    status,
    published_at,
    available_from,
    metadata
  ) values (
    p_academy_id,
    p_book_id,
    v_unit_id,
    case when cardinality(v_problem_ids) = 1 then v_problem_ids[1] else null end,
    btrim(p_title),
    nullif(btrim(p_description), ''),
    p_context,
    p_due_at,
    v_created_by,
    true,
    p_source_type,
    'published',
    now(),
    p_available_from,
    case
      when cardinality(v_excluded_student_ids) = 0 then p_metadata
      else p_metadata || jsonb_build_object('excludedStudentIds', to_jsonb(v_excluded_student_ids))
    end
  )
  returning id into v_assignment_id;

  insert into learning.assignment_items (
    assignment_id,
    book_id,
    unit_id,
    problem_id,
    sort_order,
    required
  )
  select
    v_assignment_id,
    problem.book_id,
    problem.unit_id,
    problem.id,
    input.ordinality::integer - 1,
    true
  from unnest(v_problem_ids) with ordinality input(problem_id, ordinality)
  join content.problems problem on problem.id = input.problem_id
  order by input.ordinality;
  get diagnostics v_item_count = row_count;

  insert into learning.assignment_targets (
    assignment_id,
    target_type,
    class_id,
    active
  )
  select v_assignment_id, 'class', input.class_id, true
  from unnest(v_class_ids) input(class_id);

  insert into learning.assignment_targets (
    assignment_id,
    target_type,
    student_id,
    active
  )
  select v_assignment_id, 'student', input.student_id, true
  from unnest(v_student_ids) input(student_id)
  where input.student_id <> all(v_excluded_student_ids);

  with candidates as (
    select
      input.student_id,
      primary_enrollment.class_id,
      'student_direct'::text as source_type,
      0 as priority
    from unnest(v_student_ids) input(student_id)
    left join lateral (
      select enrollment.class_id
      from core.class_students enrollment
      join core.classes class_row
        on class_row.id = enrollment.class_id
       and class_row.academy_id = p_academy_id
      where enrollment.student_id = input.student_id
        and enrollment.status = 'active'
      order by enrollment.primary_class desc, enrollment.joined_at desc, enrollment.class_id
      limit 1
    ) primary_enrollment on true
    where input.student_id <> all(v_excluded_student_ids)
    union all
    select
      enrollment.student_id,
      enrollment.class_id,
      'class_snapshot'::text,
      1
    from core.class_students enrollment
    join core.students student
      on student.id = enrollment.student_id
     and student.academy_id = p_academy_id
     and student.status = 'active'
    where enrollment.class_id = any(v_class_ids)
      and enrollment.status = 'active'
      and enrollment.student_id <> all(v_excluded_student_ids)
  ),
  selected as (
    select distinct on (student_id)
      student_id,
      class_id,
      source_type
    from candidates
    order by student_id, priority, class_id
  )
  insert into learning.assignment_recipients (
    assignment_id,
    academy_id,
    student_id,
    class_id,
    source_type,
    active,
    added_by,
    added_at
  )
  select
    v_assignment_id,
    p_academy_id,
    selected.student_id,
    selected.class_id,
    selected.source_type,
    true,
    v_created_by,
    now()
  from selected;
  get diagnostics v_recipient_count = row_count;

  if v_recipient_count = 0 then
    raise exception using errcode = '22023', message = 'Assignment targets produced no active recipients.';
  end if;

  perform private.emit_lms_invalidation_v2(
    p_academy_id => p_academy_id,
    p_domains => array['assignments'],
    p_entity_type => 'learning.assignments',
    p_entity_ids => array[v_assignment_id::text],
    p_event_id => v_mutation_id
  );

  return query
    select v_assignment_id, v_item_count, v_recipient_count, v_mutation_id;
end;
$$;

comment on function learning.create_assignment_v2(uuid, uuid, text, text[], uuid[], uuid[], text, text, timestamptz, timestamptz, jsonb, uuid[], uuid, text) is
  'Atomically creates an assignment from catalog-visible, verified content with ordered items, targets, and recipients.';

revoke all on function learning.create_assignment_v2(uuid, uuid, text, text[], uuid[], uuid[], text, text, timestamptz, timestamptz, jsonb, uuid[], uuid, text)
  from public, anon;
grant execute on function learning.create_assignment_v2(uuid, uuid, text, text[], uuid[], uuid[], text, text, timestamptz, timestamptz, jsonb, uuid[], uuid, text)
  to authenticated, service_role;

create or replace function learning.create_assignment_from_code_match_v1(
  p_academy_id uuid,
  p_job_id uuid,
  p_expected_revision integer,
  p_idempotency_key text,
  p_actor_person_id uuid
)
returns table (
  assignment_id uuid,
  mutation_id uuid,
  item_count bigint,
  recipient_count bigint,
  job_revision integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job learning.assignment_match_jobs%rowtype;
  v_problem_ids text[];
  v_source_codes text[];
  v_item_count bigint;
  v_distinct_problem_count bigint;
  v_distinct_code_count bigint;
  v_assignment_id uuid;
  v_mutation_id uuid;
  v_recipient_count bigint;
  v_job_revision integer;
  v_actor_person_id uuid;
begin
  if p_academy_id is null or p_job_id is null or p_expected_revision is null then
    raise exception using errcode = '22023', message = 'academy_id, job_id, and expected_revision are required.';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null or length(btrim(p_idempotency_key)) > 200 then
    raise exception using errcode = '22023', message = 'idempotency_key must contain 1..200 characters.';
  end if;

  if current_user <> 'service_role'
     and p_academy_id not in (
       select private.current_academy_ids(array['owner', 'admin', 'staff'])
     ) then
    raise exception using errcode = '42501', message = 'Only academy operations staff may finalize code matches.';
  end if;

  select job.*
  into v_job
  from learning.assignment_match_jobs job
  where job.id = p_job_id
  for update;

  if not found or v_job.academy_id <> p_academy_id then
    raise exception using errcode = 'P0002', message = 'Match job was not found in the academy.';
  end if;

  if v_job.assignment_id is not null then
    if v_job.finalize_idempotency_key is distinct from btrim(p_idempotency_key) then
      raise exception using errcode = '23505', message = 'Match job was already finalized with another idempotency key.';
    end if;

    select count(*) into v_item_count
    from learning.assignment_items item
    where item.assignment_id = v_job.assignment_id;

    select count(*) into v_recipient_count
    from learning.assignment_recipients recipient
    where recipient.assignment_id = v_job.assignment_id
      and recipient.active;

    return query select
      v_job.assignment_id,
      v_job.mutation_id,
      v_item_count,
      v_recipient_count,
      v_job.revision;
    return;
  end if;

  if v_job.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Match job revision is stale.';
  end if;
  if v_job.status <> 'ready' then
    raise exception using errcode = '22023', message = 'Match job must be ready before finalization.';
  end if;
  if v_job.expires_at <= now() then
    raise exception using errcode = '22023', message = 'Match job has expired.';
  end if;
  if v_job.target_student_id is null then
    raise exception using errcode = '22023', message = 'Match job requires a target student.';
  end if;
  if nullif(btrim(v_job.title), '') is null then
    raise exception using errcode = '22023', message = 'Match job requires an assignment title.';
  end if;
  if v_job.file_path is null
     or nullif(btrim(v_job.file_name), '') is null
     or v_job.file_path <> concat(p_academy_id::text, '/match-jobs/', p_job_id::text, '/source.pdf')
     or v_job.media_type is distinct from 'application/pdf'
     or v_job.file_size is null
     or v_job.file_size > 52428800
     or v_job.page_count is null
     or v_job.page_count > 200
     or v_job.source_pdf_sha256 is null then
    raise exception using errcode = '22023', message = 'Match job PDF metadata is incomplete or invalid.';
  end if;
  if coalesce(v_job.file_name, '') ~* '(정답|해설|_answer|answer[_ -]?key|solution)' then
    raise exception using errcode = '22023', message = 'Answer or solution PDFs cannot be attached to student assignments.';
  end if;

  if not exists (
    select 1
    from content.books book
    where book.id = v_job.book_id
      and book.academy_id = p_academy_id
      and book.book_key = 'nextum_math_bank'
      and book.metadata->>'visibility' = 'catalog'
  ) then
    raise exception using errcode = '22023', message = 'Match job must use the catalog-visible Nextum math bank.';
  end if;

  if not exists (
    select 1
    from learning.assignment_match_batches batch
    where batch.id = v_job.batch_id
      and batch.academy_id = p_academy_id
      and batch.status not in ('cancelled', 'expired')
      and batch.expires_at > now()
  ) then
    raise exception using errcode = '22023', message = 'Match batch is unavailable or expired.';
  end if;

  if not exists (
    select 1
    from core.students student
    where student.id = v_job.target_student_id
      and student.academy_id = p_academy_id
      and student.status = 'active'
  ) then
    raise exception using errcode = '22023', message = 'Target student must be active in the academy.';
  end if;

  if exists (
    select 1
    from learning.assignment_match_items item
    left join content.problem_source_refs source_ref
      on source_ref.academy_id = p_academy_id
     and source_ref.source_namespace = item.source_namespace
     and source_ref.external_id = item.external_code
     and source_ref.problem_id = item.problem_id
    left join content.problems problem
      on problem.id = item.problem_id
     and problem.book_id = v_job.book_id
     and problem.verified
    where item.job_id = p_job_id
      and (
        item.status <> 'matched'
        or source_ref.problem_id is null
        or problem.id is null
      )
  ) then
    raise exception using errcode = '22023', message = 'Every match item must resolve exactly to a verified bank problem.';
  end if;

  select
    array_agg(item.problem_id order by item.ordinal),
    array_agg(item.external_code::text order by item.ordinal),
    count(*),
    count(distinct item.problem_id),
    count(distinct item.external_code)
  into
    v_problem_ids,
    v_source_codes,
    v_item_count,
    v_distinct_problem_count,
    v_distinct_code_count
  from learning.assignment_match_items item
  where item.job_id = p_job_id;

  if v_item_count = 0 or v_item_count > 1000 then
    raise exception using errcode = '22023', message = 'Match job must contain between 1 and 1000 items.';
  end if;
  if v_item_count <> v_distinct_problem_count or v_item_count <> v_distinct_code_count then
    raise exception using errcode = '22023', message = 'Duplicate problem codes are not allowed in a matched PDF.';
  end if;

  if current_user <> 'service_role' then
    select actor.person_id into v_actor_person_id
    from private.current_actor() actor;
    if p_actor_person_id is distinct from v_actor_person_id then
      raise exception using errcode = '42501', message = 'actor_person_id must match the authenticated actor.';
    end if;
  else
    v_actor_person_id := coalesce(p_actor_person_id, v_job.created_by);
  end if;
  if v_actor_person_id is null then
    raise exception using errcode = '22023', message = 'An academy actor is required to finalize the match job.';
  end if;

  update learning.assignment_match_jobs
  set status = 'publishing',
      finalize_idempotency_key = btrim(p_idempotency_key),
      revision = revision + 1,
      error_message = null
  where id = p_job_id
  returning revision into v_job_revision;

  select created.assignment_id,
         created.item_count,
         created.recipient_count,
         created.mutation_id
  into v_assignment_id,
       v_item_count,
       v_recipient_count,
       v_mutation_id
  from learning.create_assignment_v2(
    p_academy_id => p_academy_id,
    p_book_id => v_job.book_id,
    p_title => v_job.title,
    p_problem_ids => v_problem_ids,
    p_class_ids => array[]::uuid[],
    p_student_ids => array[v_job.target_student_id],
    p_description => v_job.description,
    p_context => v_job.context,
    p_due_at => v_job.due_at,
    p_available_from => v_job.available_from,
    p_metadata => jsonb_build_object(
      'selection_source', 'pdf_code_match',
      'match_job_id', p_job_id,
      'source_pdf_sha256', v_job.source_pdf_sha256,
      'source_codes', to_jsonb(v_source_codes)
    ),
    p_excluded_student_ids => array[]::uuid[],
    p_created_by => v_actor_person_id,
    p_source_type => 'content_scope'
  ) created;

  insert into learning.assignment_files (
    assignment_id,
    storage_path,
    file_name,
    media_type,
    display_order,
    metadata
  ) values (
    v_assignment_id,
    v_job.file_path,
    v_job.file_name,
    'application/pdf',
    0,
    jsonb_build_object(
      'selection_source', 'pdf_code_match',
      'match_job_id', p_job_id,
      'source_pdf_sha256', v_job.source_pdf_sha256,
      'student_visible', true
    )
  )
  on conflict do nothing;

  update learning.assignment_match_jobs
  set status = 'assigned',
      assignment_id = v_assignment_id,
      mutation_id = v_mutation_id,
      finalized_at = now(),
      revision = revision + 1,
      summary = summary || jsonb_build_object(
        'item_count', v_item_count,
        'recipient_count', v_recipient_count
      ),
      metadata = metadata || jsonb_build_object(
        'finalized_assignment_id', v_assignment_id,
        'original_target_student_id', v_job.target_student_id
      )
  where id = p_job_id
  returning revision into v_job_revision;

  update learning.assignment_match_batches batch
  set status = case
    when not exists (
      select 1
      from learning.assignment_match_jobs sibling
      where sibling.batch_id = batch.id
        and sibling.status <> 'assigned'
    ) then 'assigned'
    when exists (
      select 1
      from learning.assignment_match_jobs sibling
      where sibling.batch_id = batch.id
        and sibling.status = 'assigned'
    ) then 'partially_assigned'
    else batch.status
  end
  where batch.id = v_job.batch_id;

  return query select
    v_assignment_id,
    v_mutation_id,
    v_item_count,
    v_recipient_count,
    v_job_revision;
end;
$$;

comment on function learning.create_assignment_from_code_match_v1(uuid, uuid, integer, text, uuid) is
  'Locks and validates one ready PDF-code match job, creates a v2 single-bank assignment, attaches its source PDF, and records an idempotent result.';

revoke all on function learning.create_assignment_from_code_match_v1(uuid, uuid, integer, text, uuid)
  from public, anon, authenticated;
grant execute on function learning.create_assignment_from_code_match_v1(uuid, uuid, integer, text, uuid)
  to service_role;

create or replace function content.register_studyq_import_asset_attempt_v1(
  p_attempt_id uuid,
  p_storage_paths text[]
)
returns table (
  storage_path text,
  should_upload boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt content.studyq_import_attempts%rowtype;
  v_run content.import_runs%rowtype;
  v_paths text[] := coalesce(p_storage_paths, array[]::text[]);
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'Only the service role may register StudyQ asset attempts.';
  end if;
  select attempt.*
  into v_attempt
  from content.studyq_import_attempts attempt
  where attempt.id = p_attempt_id
  for update;
  if not found or v_attempt.status <> 'running' then
    raise exception using errcode = '22023', message = 'A running StudyQ import attempt is required.';
  end if;
  select run.* into v_run
  from content.import_runs run
  where run.id = v_attempt.import_run_id;
  if not found then
    raise exception using errcode = '22023', message = 'The StudyQ import run was not found.';
  end if;
  if cardinality(v_paths) = 0 or cardinality(v_paths) > 1000
     or cardinality(v_paths) <> (
       select count(distinct path_value) from unnest(v_paths) path_value
     )
     or exists (
       select 1
       from unnest(v_paths) path_value
       where path_value is null
          or btrim(path_value) = ''
          or path_value not like v_run.academy_id::text || '/nextum_math_bank/%'
     ) then
    raise exception using errcode = '22023', message = 'StudyQ asset paths must contain 1..1,000 unique canonical bank paths.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'studyq-bank:' || v_run.academy_id::text || ':' || v_run.book_id::text,
      72401
    )
  );
  if exists (
    select 1
    from content.studyq_import_attempt_assets asset_attempt
    where asset_attempt.asset_bucket = v_run.asset_bucket
      and asset_attempt.storage_path = any(v_paths)
      and asset_attempt.cleanup_status = 'claimed'
  ) then
    raise exception using errcode = '55000', message = 'A StudyQ asset cleanup is in progress; retry the import after cleanup finishes.';
  end if;

  insert into content.studyq_import_attempt_assets (
    attempt_id,
    asset_bucket,
    storage_path,
    existed_before,
    upload_status,
    cleanup_status
  )
  select
    p_attempt_id,
    v_run.asset_bucket,
    path_value,
    exists (
      select 1
      from storage.objects object
      where object.bucket_id = v_run.asset_bucket
        and object.name = path_value
    ),
    case when exists (
      select 1
      from storage.objects object
      where object.bucket_id = v_run.asset_bucket
        and object.name = path_value
    ) then 'skipped_existing' else 'planned' end,
    case when exists (
      select 1
      from storage.objects object
      where object.bucket_id = v_run.asset_bucket
        and object.name = path_value
    ) then 'not_needed' else 'pending' end
  from unnest(v_paths) path_value
  on conflict on constraint studyq_import_attempt_assets_pkey do nothing;

  return query
  select asset_attempt.storage_path, not asset_attempt.existed_before
  from content.studyq_import_attempt_assets asset_attempt
  where asset_attempt.attempt_id = p_attempt_id
    and asset_attempt.storage_path = any(v_paths)
  order by asset_attempt.storage_path;
end;
$$;

comment on function content.register_studyq_import_asset_attempt_v1(uuid, text[]) is
  'Records whether deterministic StudyQ asset paths existed before one import attempt and blocks reuse while cleanup is claimed.';
revoke all on function content.register_studyq_import_asset_attempt_v1(uuid, text[])
  from public, anon, authenticated;
grant execute on function content.register_studyq_import_asset_attempt_v1(uuid, text[])
  to service_role;

create or replace function content.claim_studyq_import_asset_cleanup_v1(
  p_attempt_id uuid,
  p_limit integer default 1000
)
returns table (
  storage_path text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt content.studyq_import_attempts%rowtype;
  v_run content.import_runs%rowtype;
  v_claimed_paths text[] := array[]::text[];
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'Only the service role may claim StudyQ asset cleanup.';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception using errcode = '22023', message = 'cleanup limit must be between 1 and 1,000.';
  end if;
  select attempt.*
  into v_attempt
  from content.studyq_import_attempts attempt
  where attempt.id = p_attempt_id
  for update;
  if not found or v_attempt.status not in ('failed', 'cleanup_pending', 'cleanup_failed', 'cleaned') then
    raise exception using errcode = '22023', message = 'A failed StudyQ import attempt is required for cleanup.';
  end if;
  select run.* into v_run
  from content.import_runs run
  where run.id = v_attempt.import_run_id;
  if not found then
    raise exception using errcode = '22023', message = 'The StudyQ import run was not found.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'studyq-bank:' || v_run.academy_id::text || ':' || v_run.book_id::text,
      72401
    )
  );

  -- A lost HTTP response after a successful claim must be retryable: return
  -- the same still-claimed paths to the same cleanup attempt before claiming
  -- anything new.
  select coalesce(array_agg(existing_claim.storage_path order by existing_claim.storage_path), array[]::text[])
  into v_claimed_paths
  from (
    select distinct asset_attempt.storage_path
    from content.studyq_import_attempt_assets asset_attempt
    where asset_attempt.cleanup_status = 'claimed'
      and asset_attempt.cleanup_claimed_by = p_attempt_id
    order by asset_attempt.storage_path
    limit p_limit
  ) existing_claim;
  if cardinality(v_claimed_paths) > 0 then
    return query select unnest(v_claimed_paths);
    return;
  end if;

  -- If the Storage API already removed a previously observed-new object, make
  -- the retry idempotent without issuing another delete request.
  update content.studyq_import_attempt_assets creator
  set cleanup_status = 'deleted',
      cleanup_error = coalesce(creator.cleanup_error, 'Storage object was already absent during cleanup retry.'),
      deleted_at = coalesce(creator.deleted_at, now())
  from content.studyq_import_attempts creator_attempt
  join content.import_runs creator_run on creator_run.id = creator_attempt.import_run_id
  where creator_attempt.id = creator.attempt_id
    and creator_run.book_id = v_run.book_id
    and creator_run.academy_id = v_run.academy_id
    and not creator.existed_before
    and creator.cleanup_status in ('pending', 'retained', 'failed')
    and not exists (
      select 1
      from storage.objects object
      where object.bucket_id = creator.asset_bucket
        and object.name = creator.storage_path
    );

  select coalesce(array_agg(candidate.storage_path order by candidate.storage_path), array[]::text[])
  into v_claimed_paths
  from (
    select distinct creator.storage_path
    from content.studyq_import_attempt_assets creator
    join content.studyq_import_attempts creator_attempt
      on creator_attempt.id = creator.attempt_id
    join content.import_runs creator_run on creator_run.id = creator_attempt.import_run_id
    where creator_run.book_id = v_run.book_id
      and creator_run.academy_id = v_run.academy_id
      and not creator.existed_before
      and creator.cleanup_status in ('pending', 'retained', 'failed')
      and exists (
        select 1
        from storage.objects object
        where object.bucket_id = creator.asset_bucket
          and object.name = creator.storage_path
      )
      and not exists (
        select 1
        from content.assets canonical_asset
        where canonical_asset.storage_path = creator.storage_path
      )
      and not exists (
        select 1
        from content.studyq_import_stage_problems other_stage
        join content.import_runs other_run on other_run.id = other_stage.import_run_id
        where other_run.id <> v_attempt.import_run_id
          and other_run.book_id = v_run.book_id
          and other_run.status in ('running', 'succeeded')
          and other_stage.payload#>>'{asset,storage_path}' = creator.storage_path
      )
      and not exists (
        select 1
        from content.studyq_import_attempt_assets active_asset
        join content.studyq_import_attempts active_attempt
          on active_attempt.id = active_asset.attempt_id
        where active_asset.asset_bucket = creator.asset_bucket
          and active_asset.storage_path = creator.storage_path
          and active_attempt.id <> p_attempt_id
          and active_attempt.status in ('running', 'cleanup_pending')
      )
      and not exists (
        select 1
        from content.studyq_import_attempt_assets other_claim
        where other_claim.asset_bucket = creator.asset_bucket
          and other_claim.storage_path = creator.storage_path
          and other_claim.cleanup_status = 'claimed'
          and other_claim.cleanup_claimed_by is distinct from p_attempt_id
      )
    order by creator.storage_path
    limit p_limit
  ) candidate;

  update content.studyq_import_attempt_assets creator
  set cleanup_status = 'claimed',
      cleanup_claimed_by = p_attempt_id,
      cleanup_claimed_at = now(),
      cleanup_error = null
  from content.studyq_import_attempts creator_attempt
  join content.import_runs creator_run on creator_run.id = creator_attempt.import_run_id
  where creator_attempt.id = creator.attempt_id
    and creator_run.book_id = v_run.book_id
    and creator_run.academy_id = v_run.academy_id
    and creator.storage_path = any(v_claimed_paths)
    and not creator.existed_before
    and creator.cleanup_status in ('pending', 'retained', 'failed');

  update content.studyq_import_attempt_assets creator
  set cleanup_status = 'retained',
      cleanup_error = 'Retained because canonical content or another active import references this path.'
  from content.studyq_import_attempts creator_attempt
  join content.import_runs creator_run on creator_run.id = creator_attempt.import_run_id
  where creator_attempt.id = creator.attempt_id
    and creator_run.book_id = v_run.book_id
    and creator_run.academy_id = v_run.academy_id
    and not creator.existed_before
    and creator.cleanup_status in ('pending', 'failed');

  update content.studyq_import_attempts attempt
  set status = case when cardinality(v_claimed_paths) > 0 then 'cleanup_pending' else 'cleaned' end,
      stats = attempt.stats || jsonb_build_object(
        'cleanup_last_claim_count', cardinality(v_claimed_paths),
        'cleanup_last_claimed_at', now()
      ),
      finished_at = case when cardinality(v_claimed_paths) = 0 then coalesce(attempt.finished_at, now()) else null end
  where attempt.id = p_attempt_id;

  return query select unnest(v_claimed_paths);
end;
$$;

comment on function content.claim_studyq_import_asset_cleanup_v1(uuid, integer) is
  'Claims only attempt-created StudyQ Storage paths that have no canonical, active-run, active-attempt, or competing-cleanup reference.';
revoke all on function content.claim_studyq_import_asset_cleanup_v1(uuid, integer)
  from public, anon, authenticated;
grant execute on function content.claim_studyq_import_asset_cleanup_v1(uuid, integer)
  to service_role;

create or replace function content.complete_studyq_import_asset_cleanup_v1(
  p_attempt_id uuid,
  p_storage_paths text[],
  p_succeeded boolean,
  p_error_message text default null
)
returns table (
  deleted_count bigint,
  failed_count bigint
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt content.studyq_import_attempts%rowtype;
  v_run content.import_runs%rowtype;
  v_paths text[] := coalesce(p_storage_paths, array[]::text[]);
  v_deleted_count bigint;
  v_failed_count bigint;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'Only the service role may complete StudyQ asset cleanup.';
  end if;
  if p_succeeded is null
     or cardinality(v_paths) = 0
     or cardinality(v_paths) > 1000
     or cardinality(v_paths) <> (
       select count(distinct path_value) from unnest(v_paths) path_value
     ) then
    raise exception using errcode = '22023', message = 'Cleanup completion requires 1..1,000 unique paths and an outcome.';
  end if;
  select attempt.*
  into v_attempt
  from content.studyq_import_attempts attempt
  where attempt.id = p_attempt_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'The StudyQ import attempt was not found.';
  end if;
  select run.* into v_run
  from content.import_runs run
  where run.id = v_attempt.import_run_id;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'studyq-bank:' || v_run.academy_id::text || ':' || v_run.book_id::text,
      72401
    )
  );

  update content.studyq_import_attempt_assets asset_attempt
  set cleanup_status = case
        when not p_succeeded then 'failed'
        when exists (
          select 1
          from storage.objects object
          where object.bucket_id = asset_attempt.asset_bucket
            and object.name = asset_attempt.storage_path
        ) then 'failed'
        else 'deleted'
      end,
      cleanup_error = case
        when not p_succeeded then left(coalesce(nullif(p_error_message, ''), 'Storage remove failed.'), 4000)
        when exists (
          select 1
          from storage.objects object
          where object.bucket_id = asset_attempt.asset_bucket
            and object.name = asset_attempt.storage_path
        ) then 'Storage object still exists after remove returned success.'
        else null
      end,
      deleted_at = case
        when p_succeeded and not exists (
          select 1
          from storage.objects object
          where object.bucket_id = asset_attempt.asset_bucket
            and object.name = asset_attempt.storage_path
        ) then now()
        else asset_attempt.deleted_at
      end
  where asset_attempt.cleanup_claimed_by = p_attempt_id
    and asset_attempt.cleanup_status = 'claimed'
    and asset_attempt.storage_path = any(v_paths);

  select
    count(*) filter (where asset_attempt.cleanup_status = 'deleted'),
    count(*) filter (where asset_attempt.cleanup_status = 'failed')
  into v_deleted_count, v_failed_count
  from content.studyq_import_attempt_assets asset_attempt
  where asset_attempt.cleanup_claimed_by = p_attempt_id
    and asset_attempt.storage_path = any(v_paths);

  update content.studyq_import_attempts attempt
  set status = case when v_failed_count > 0 then 'cleanup_failed' else 'failed' end,
      stats = attempt.stats || jsonb_build_object(
        'cleanup_last_deleted_count', v_deleted_count,
        'cleanup_last_failed_count', v_failed_count,
        'cleanup_last_completed_at', now()
      ),
      error_message = case
        when v_failed_count > 0 then left(coalesce(nullif(p_error_message, ''), 'Storage cleanup requires retry.'), 4000)
        else attempt.error_message
      end
  where attempt.id = p_attempt_id;

  return query select v_deleted_count, v_failed_count;
end;
$$;

comment on function content.complete_studyq_import_asset_cleanup_v1(uuid, text[], boolean, text) is
  'Audits Storage API cleanup results, verifies successful removals disappeared from storage.objects, and leaves failures retryable.';
revoke all on function content.complete_studyq_import_asset_cleanup_v1(uuid, text[], boolean, text)
  from public, anon, authenticated;
grant execute on function content.complete_studyq_import_asset_cleanup_v1(uuid, text[], boolean, text)
  to service_role;

create or replace function private.prevent_claimed_studyq_asset_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from content.studyq_import_attempt_assets asset_attempt
    where asset_attempt.storage_path = new.storage_path
      and asset_attempt.cleanup_status = 'claimed'
  ) then
    raise exception using errcode = '55000', message = 'Cannot reference a StudyQ asset while its Storage cleanup is claimed.';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_claimed_studyq_asset_reference()
  from public, anon, authenticated;

drop trigger if exists prevent_claimed_studyq_asset_reference on content.assets;
create trigger prevent_claimed_studyq_asset_reference
  before insert or update of storage_path on content.assets
  for each row execute function private.prevent_claimed_studyq_asset_reference();

create or replace function content.commit_studyq_import_v2(
  p_import_run_id uuid,
  p_attempt_id uuid default null
)
returns table (
  added_count bigint,
  unchanged_count bigint,
  repaired_count bigint,
  bank_problem_count bigint,
  visibility text,
  taxonomy_revision_id uuid,
  mutation_id uuid,
  idempotent boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run content.import_runs%rowtype;
  v_import_attempt content.studyq_import_attempts%rowtype;
  v_book content.books%rowtype;
  v_stage_count bigint;
  v_skill_count bigint;
  v_current_count bigint;
  v_added_count bigint;
  v_unchanged_count bigint;
  v_repaired_count bigint;
  v_final_count bigint;
  v_taxonomy_revision_id uuid;
  v_taxonomy_status text;
  v_visibility text;
  v_mutation_id uuid := gen_random_uuid();
  v_was_succeeded boolean;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'Only the service role may commit StudyQ imports.';
  end if;
  if p_import_run_id is null then
    raise exception using errcode = '22023', message = 'import_run_id is required.';
  end if;

  select run.*
  into v_run
  from content.import_runs run
  where run.id = p_import_run_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'StudyQ import run was not found.';
  end if;
  v_was_succeeded := v_run.status = 'succeeded';
  if p_attempt_id is not null then
    select attempt.*
    into v_import_attempt
    from content.studyq_import_attempts attempt
    where attempt.id = p_attempt_id
    for update;
    if not found
       or v_import_attempt.import_run_id <> p_import_run_id
       or v_import_attempt.status <> 'running' then
      raise exception using errcode = '22023', message = 'A running attempt belonging to the StudyQ import run is required.';
    end if;
  end if;

  -- The lock is held until this RPC transaction commits or rolls back. All
  -- canonical hierarchy, problem, source-ref, taxonomy, count, and publication
  -- mutations therefore serialize per academy + bank even when HTTP staging
  -- requests overlap.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'studyq-bank:' || v_run.academy_id::text || ':' || v_run.book_id::text,
      72401
    )
  );

  select book.*
  into v_book
  from content.books book
  where book.id = v_run.book_id
  for update;
  if not found
     or v_book.academy_id is distinct from v_run.academy_id
     or v_book.book_key <> 'nextum_math_bank' then
    raise exception using errcode = '22023', message = 'The import run does not target the academy Nextum math bank.';
  end if;
  if v_run.bundle_version <> 'studyq-bank-bundle-v2' then
    raise exception using errcode = '22023', message = 'Unsupported StudyQ bundle version.';
  end if;
  if v_run.import_mode = 'initial'
     and (v_run.bundle_problem_count <> 9538 or v_run.expected_bank_problem_count <> 9538) then
    raise exception using errcode = '22023', message = 'The initial StudyQ import must contain and result in exactly 9,538 problems.';
  end if;
  if v_run.import_mode = 'incremental'
     and coalesce(v_book.metadata->>'visibility', 'import_staging') <> 'catalog' then
    raise exception using errcode = '22023', message = 'Incremental imports require the initial bank to be catalog-visible.';
  end if;

  select count(*) into v_stage_count
  from content.studyq_import_stage_problems stage
  where stage.import_run_id = p_import_run_id;
  if v_stage_count <> v_run.bundle_problem_count then
    raise exception using errcode = '22023', message = 'Staged problem count does not match the approved bundle.';
  end if;
  select count(*) into v_skill_count
  from content.studyq_import_stage_skills stage
  where stage.import_run_id = p_import_run_id;
  if v_skill_count = 0 then
    raise exception using errcode = '22023', message = 'The approved StudyQ taxonomy has no staged skills.';
  end if;

  if exists (
    select 1
    from content.studyq_import_stage_problems stage
    where stage.import_run_id = p_import_run_id
      and (
        stage.external_id !~ '^[0-9]{7}$'
        or stage.payload->>'external_id' is distinct from stage.external_id
        or stage.payload->>'problem_id' is distinct from stage.problem_id
        or stage.payload->>'content_sha256' is distinct from stage.content_sha256
        or stage.payload#>>'{problem,id}' is distinct from stage.problem_id
        or stage.payload#>>'{source_ref,external_id}' is distinct from stage.external_id
        or stage.payload#>>'{source_ref,problem_id}' is distinct from stage.problem_id
        or stage.payload#>>'{source_ref,content_sha256}' is distinct from stage.content_sha256
        or stage.payload#>>'{problem,metadata,studyq,source_namespace}' is distinct from 'studyq'
        or stage.payload#>>'{problem,metadata,studyq,external_id}' is distinct from stage.external_id
        or stage.payload#>>'{problem,metadata,studyq,content_sha256}' is distinct from stage.content_sha256
        or stage.payload#>>'{problem,metadata,studyq,bundle_sha256}' is distinct from v_run.bundle_sha256
        or stage.payload#>>'{problem,metadata,verification,approved}' is distinct from 'true'
        or stage.payload#>>'{asset,bucket_id}' is distinct from v_run.asset_bucket
        or stage.payload#>>'{asset,problem_id}' is distinct from stage.problem_id
        or stage.payload#>>'{source_ref,source_namespace}' is distinct from 'studyq'
        or nullif(stage.payload#>>'{unit,id}', '') is null
        or nullif(stage.payload#>>'{concept,id}', '') is null
        or nullif(stage.payload#>>'{problem_type,id}', '') is null
        or nullif(stage.payload#>>'{asset,id}', '') is null
        or jsonb_typeof(stage.payload->'problem'->'answer') <> 'object'
        or jsonb_typeof(stage.payload->'problem'->'answer_key') <> 'object'
        or jsonb_typeof(stage.payload->'problem'->'public_payload') <> 'object'
      )
  ) then
    raise exception using errcode = '22023', message = 'A staged StudyQ problem has an invalid or inconsistent canonical payload.';
  end if;
  if exists (
    select 1
    from content.studyq_import_stage_skills stage
    where stage.import_run_id = p_import_run_id
      and (
        stage.payload->>'id' is distinct from stage.skill_id::text
        or stage.payload->>'code' is distinct from stage.code
        or coalesce(stage.payload->>'subject', '수학') <> '수학'
      )
  ) then
    raise exception using errcode = '22023', message = 'A staged StudyQ skill has an invalid canonical payload.';
  end if;
  if exists (
    select 1
    from content.studyq_import_stage_problems stage
    left join content.studyq_import_stage_skills skill
      on skill.import_run_id = p_import_run_id
     and skill.code = stage.payload#>>'{tag,skill_code}'
    where stage.import_run_id = p_import_run_id
      and (
        skill.code is null
        or stage.payload#>>'{tag,skill_id}' is distinct from skill.skill_id::text
      )
  ) then
    raise exception using errcode = '22023', message = 'A staged problem tag references an unknown staged skill.';
  end if;
  if exists (
    select 1
    from (
      select stage.payload#>>'{unit,id}' as entity_id
      from content.studyq_import_stage_problems stage
      where stage.import_run_id = p_import_run_id
      group by stage.payload#>>'{unit,id}'
      having count(distinct stage.payload->'unit') > 1
      union all
      select stage.payload#>>'{concept,id}'
      from content.studyq_import_stage_problems stage
      where stage.import_run_id = p_import_run_id
      group by stage.payload#>>'{concept,id}'
      having count(distinct stage.payload->'concept') > 1
      union all
      select stage.payload#>>'{problem_type,id}'
      from content.studyq_import_stage_problems stage
      where stage.import_run_id = p_import_run_id
      group by stage.payload#>>'{problem_type,id}'
      having count(distinct stage.payload->'problem_type') > 1
    ) inconsistent_hierarchy
  ) then
    raise exception using errcode = '22023', message = 'The staged hierarchy contains conflicting definitions.';
  end if;

  -- Source-code and stable-ID conflicts are checked again under the bank lock;
  -- a stale dry-run can never turn changed content into a partial verified row.
  if exists (
    select 1
    from content.studyq_import_stage_problems stage
    join content.problem_source_refs source_ref
      on source_ref.academy_id = v_run.academy_id
     and source_ref.source_namespace = 'studyq'
     and source_ref.external_id = stage.external_id
    where stage.import_run_id = p_import_run_id
      and (
        source_ref.problem_id <> stage.problem_id
        or source_ref.content_sha256 <> stage.content_sha256
      )
  ) then
    raise exception using errcode = '23505', message = 'A StudyQ source code already maps to different content.';
  end if;
  if exists (
    select 1
    from content.studyq_import_stage_problems stage
    join content.problems problem on problem.id = stage.problem_id
    where stage.import_run_id = p_import_run_id
      and (
        problem.book_id <> v_run.book_id
        or problem.metadata#>>'{studyq,source_namespace}' is distinct from 'studyq'
        or problem.metadata#>>'{studyq,external_id}' is distinct from stage.external_id
        or problem.metadata#>>'{studyq,content_sha256}' is distinct from stage.content_sha256
      )
  ) then
    raise exception using errcode = '23505', message = 'A stable StudyQ problem ID already maps to different content.';
  end if;
  if exists (
    select 1
    from content.studyq_import_stage_problems stage
    join content.problem_source_refs source_ref
      on source_ref.academy_id = v_run.academy_id
     and source_ref.source_namespace = 'studyq'
     and source_ref.problem_id = stage.problem_id
    where stage.import_run_id = p_import_run_id
      and source_ref.external_id <> stage.external_id
  ) then
    raise exception using errcode = '23505', message = 'A stable StudyQ problem ID already has a different source code.';
  end if;
  if exists (
    select 1
    from content.studyq_import_stage_problems stage
    join content.units unit_row on unit_row.id = (stage.payload#>>'{unit,id}')::uuid
    where stage.import_run_id = p_import_run_id
      and (
        unit_row.book_id <> v_run.book_id
        or unit_row.unit_key <> stage.payload#>>'{unit,unit_key}'
      )
  ) or exists (
    select 1
    from content.studyq_import_stage_problems stage
    join content.concepts concept_row on concept_row.id = (stage.payload#>>'{concept,id}')::uuid
    where stage.import_run_id = p_import_run_id
      and (
        concept_row.book_id <> v_run.book_id
        or concept_row.unit_id is distinct from (stage.payload#>>'{concept,unit_id}')::uuid
        or concept_row.name <> stage.payload#>>'{concept,name}'
      )
  ) or exists (
    select 1
    from content.studyq_import_stage_problems stage
    join content.problem_types type_row on type_row.id = (stage.payload#>>'{problem_type,id}')::uuid
    where stage.import_run_id = p_import_run_id
      and (
        type_row.book_id <> v_run.book_id
        or type_row.unit_id is distinct from (stage.payload#>>'{problem_type,unit_id}')::uuid
        or type_row.name <> stage.payload#>>'{problem_type,name}'
      )
  ) then
    raise exception using errcode = '23505', message = 'A stable StudyQ hierarchy ID already maps to a different entity.';
  end if;
  if exists (
    select 1
    from content.studyq_import_stage_problems stage
    join content.assets asset on asset.id = (stage.payload#>>'{asset,id}')::uuid
    where stage.import_run_id = p_import_run_id
      and (
        asset.book_id is distinct from v_run.book_id
        or asset.problem_id is distinct from stage.problem_id
        or asset.kind <> coalesce(stage.payload#>>'{asset,kind}', 'problem_image')
        or asset.storage_path <> stage.payload#>>'{asset,storage_path}'
        or asset.metadata->>'sha256' is distinct from stage.payload#>>'{asset,metadata,sha256}'
      )
  ) then
    raise exception using errcode = '23505', message = 'A stable StudyQ asset ID already maps to different content.';
  end if;

  select count(*)
  into v_current_count
  from content.problems problem
  where problem.book_id = v_run.book_id;
  select count(*)
  into v_added_count
  from content.studyq_import_stage_problems stage
  where stage.import_run_id = p_import_run_id
    and not exists (
      select 1 from content.problems problem where problem.id = stage.problem_id
    );

  -- This optimistic total is mandatory for every import, including hidden
  -- increments. It is deliberately outside the publish_requested branch.
  if v_current_count + v_added_count <> v_run.expected_bank_problem_count then
    raise exception using
      errcode = '40001',
      message = 'StudyQ bank count changed after preflight; regenerate the increment against the current bank.';
  end if;

  if exists (
    select 1
    from content.studyq_import_stage_problems stage
    join content.studyq_import_attempt_assets asset_attempt
      on asset_attempt.asset_bucket = v_run.asset_bucket
     and asset_attempt.storage_path = stage.payload#>>'{asset,storage_path}'
     and asset_attempt.cleanup_status = 'claimed'
    where stage.import_run_id = p_import_run_id
  ) then
    raise exception using errcode = '55000', message = 'A staged StudyQ asset is currently claimed for cleanup.';
  end if;

  if exists (
    select 1
    from content.studyq_import_stage_problems stage
    where stage.import_run_id = p_import_run_id
      and not exists (
        select 1
        from storage.objects object
        where object.bucket_id = v_run.asset_bucket
          and object.name = stage.payload#>>'{asset,storage_path}'
      )
  ) then
    raise exception using errcode = '22023', message = 'At least one staged StudyQ asset is missing from Storage.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('studyq-taxonomy:pbl_math_v1', 72402)
  );
  select revision.id, revision.status
  into v_taxonomy_revision_id, v_taxonomy_status
  from content.analysis_taxonomy_revisions revision
  where revision.metadata->>'import_key' = 'pbl_math_v1'
  order by revision.revision_number desc
  limit 1
  for update;
  if v_taxonomy_status = 'retired' then
    raise exception using errcode = '22023', message = 'The PBL Math v1 taxonomy revision is retired.';
  end if;
  if v_taxonomy_revision_id is null then
    insert into content.analysis_taxonomy_revisions (
      revision_number, status, summary, published_at, metadata
    )
    select
      coalesce(max(revision.revision_number), 0) + 1,
      'published',
      'PBL Math v1 StudyQ taxonomy',
      now(),
      jsonb_build_object(
        'import_key', 'pbl_math_v1',
        'source', 'studyq',
        'created_by_script', 'scripts/import-studyq-bank.mjs'
      )
    from content.analysis_taxonomy_revisions revision
    returning id into v_taxonomy_revision_id;
  elsif v_taxonomy_status = 'draft' then
    update content.analysis_taxonomy_revisions revision
    set status = 'published', published_at = now()
    where revision.id = v_taxonomy_revision_id;
  end if;

  if exists (
    select 1
    from content.studyq_import_stage_skills stage
    join content.analysis_skills skill
      on skill.taxonomy_revision_id = v_taxonomy_revision_id
     and skill.code = stage.code
    where stage.import_run_id = p_import_run_id
      and skill.id <> stage.skill_id
  ) then
    raise exception using errcode = '23505', message = 'A StudyQ taxonomy skill code already has a different stable ID.';
  end if;

  insert into content.analysis_skills (
    id, taxonomy_revision_id, code, subject, school_type, grade, semester,
    unit_code, unit_name, name, active, sort_order, metadata
  )
  select
    stage.skill_id,
    v_taxonomy_revision_id,
    stage.code,
    coalesce(stage.payload->>'subject', '수학'),
    nullif(stage.payload->>'school_type', ''),
    nullif(stage.payload->>'grade', ''),
    nullif(stage.payload->>'semester', '')::smallint,
    nullif(stage.payload->>'unit_code', ''),
    stage.payload->>'unit_name',
    stage.payload->>'name',
    coalesce((stage.payload->>'active')::boolean, true),
    coalesce((stage.payload->>'sort_order')::integer, 0),
    coalesce(stage.payload->'metadata', '{}'::jsonb)
  from content.studyq_import_stage_skills stage
  where stage.import_run_id = p_import_run_id
  on conflict on constraint analysis_skills_taxonomy_revision_id_code_key do update
  set subject = excluded.subject,
      school_type = excluded.school_type,
      grade = excluded.grade,
      semester = excluded.semester,
      unit_code = excluded.unit_code,
      unit_name = excluded.unit_name,
      name = excluded.name,
      active = excluded.active,
      sort_order = excluded.sort_order,
      metadata = excluded.metadata
  where (analysis_skills.subject, analysis_skills.school_type, analysis_skills.grade,
         analysis_skills.semester, analysis_skills.unit_code, analysis_skills.unit_name,
         analysis_skills.name, analysis_skills.active, analysis_skills.sort_order,
         analysis_skills.metadata)
    is distinct from
        (excluded.subject, excluded.school_type, excluded.grade, excluded.semester,
         excluded.unit_code, excluded.unit_name, excluded.name, excluded.active,
         excluded.sort_order, excluded.metadata);

  select count(*)
  into v_unchanged_count
  from content.studyq_import_stage_problems stage
  join content.problems problem
    on problem.id = stage.problem_id
   and problem.book_id = v_run.book_id
   and problem.verified
   and problem.image_path = stage.payload#>>'{asset,storage_path}'
   and problem.metadata#>>'{studyq,content_sha256}' = stage.content_sha256
  where stage.import_run_id = p_import_run_id
    and exists (
      select 1
      from content.assets asset
      where asset.id = (stage.payload#>>'{asset,id}')::uuid
        and asset.problem_id = stage.problem_id
        and asset.storage_path = stage.payload#>>'{asset,storage_path}'
        and asset.metadata->>'sha256' = stage.payload#>>'{asset,metadata,sha256}'
    )
    and exists (
      select 1
      from content.problem_source_refs source_ref
      where source_ref.academy_id = v_run.academy_id
        and source_ref.source_namespace = 'studyq'
        and source_ref.external_id = stage.external_id
        and source_ref.problem_id = stage.problem_id
        and source_ref.content_sha256 = stage.content_sha256
    )
    and exists (
      select 1
      from content.problem_analysis_tags tag
      join content.analysis_skills skill on skill.id = tag.analysis_skill_id
      where tag.problem_id = stage.problem_id
        and tag.taxonomy_revision_id = v_taxonomy_revision_id
        and tag.review_status = 'approved'
        and skill.code = stage.payload#>>'{tag,skill_code}'
        and tag.challenge_band = (stage.payload#>>'{tag,challenge_band}')::smallint
        and tag.equivalence_key = stage.payload#>>'{tag,equivalence_key}'
    );
  v_repaired_count := v_stage_count - v_added_count - v_unchanged_count;

  insert into content.units (
    id, book_id, unit_key, part_name, name, page_start, page_end, sort_order, metadata
  )
  select distinct on ((stage.payload#>>'{unit,id}')::uuid)
    (stage.payload#>>'{unit,id}')::uuid,
    v_run.book_id,
    stage.payload#>>'{unit,unit_key}',
    stage.payload#>>'{unit,part_name}',
    stage.payload#>>'{unit,name}',
    nullif(stage.payload#>>'{unit,page_start}', '')::integer,
    nullif(stage.payload#>>'{unit,page_end}', '')::integer,
    coalesce((stage.payload#>>'{unit,sort_order}')::integer, 0),
    coalesce(stage.payload#>'{unit,metadata}', '{}'::jsonb)
  from content.studyq_import_stage_problems stage
  where stage.import_run_id = p_import_run_id
  order by (stage.payload#>>'{unit,id}')::uuid, stage.external_id
  on conflict (id) do update
  set unit_key = excluded.unit_key,
      part_name = excluded.part_name,
      name = excluded.name,
      page_start = excluded.page_start,
      page_end = excluded.page_end,
      sort_order = excluded.sort_order,
      metadata = excluded.metadata
  where units.book_id = excluded.book_id
    and (units.unit_key, units.part_name, units.name, units.page_start,
         units.page_end, units.sort_order, units.metadata)
      is distinct from
        (excluded.unit_key, excluded.part_name, excluded.name, excluded.page_start,
         excluded.page_end, excluded.sort_order, excluded.metadata);

  insert into content.concepts (
    id, book_id, unit_id, name, name_raw, sort_order, detail
  )
  select distinct on ((stage.payload#>>'{concept,id}')::uuid)
    (stage.payload#>>'{concept,id}')::uuid,
    v_run.book_id,
    (stage.payload#>>'{concept,unit_id}')::uuid,
    stage.payload#>>'{concept,name}',
    nullif(stage.payload#>>'{concept,name_raw}', ''),
    coalesce((stage.payload#>>'{concept,sort_order}')::integer, 0),
    stage.payload#>'{concept,detail}'
  from content.studyq_import_stage_problems stage
  where stage.import_run_id = p_import_run_id
  order by (stage.payload#>>'{concept,id}')::uuid, stage.external_id
  on conflict (id) do update
  set unit_id = excluded.unit_id,
      name = excluded.name,
      name_raw = excluded.name_raw,
      sort_order = excluded.sort_order,
      detail = excluded.detail
  where concepts.book_id = excluded.book_id
    and (concepts.unit_id, concepts.name, concepts.name_raw, concepts.sort_order, concepts.detail)
      is distinct from
        (excluded.unit_id, excluded.name, excluded.name_raw, excluded.sort_order, excluded.detail);

  insert into content.problem_types (
    id, book_id, unit_id, concept_id, name, name_raw, sort_order
  )
  select distinct on ((stage.payload#>>'{problem_type,id}')::uuid)
    (stage.payload#>>'{problem_type,id}')::uuid,
    v_run.book_id,
    (stage.payload#>>'{problem_type,unit_id}')::uuid,
    (stage.payload#>>'{problem_type,concept_id}')::uuid,
    stage.payload#>>'{problem_type,name}',
    nullif(stage.payload#>>'{problem_type,name_raw}', ''),
    coalesce((stage.payload#>>'{problem_type,sort_order}')::integer, 0)
  from content.studyq_import_stage_problems stage
  where stage.import_run_id = p_import_run_id
  order by (stage.payload#>>'{problem_type,id}')::uuid, stage.external_id
  on conflict (id) do update
  set unit_id = excluded.unit_id,
      concept_id = excluded.concept_id,
      name = excluded.name,
      name_raw = excluded.name_raw,
      sort_order = excluded.sort_order
  where problem_types.book_id = excluded.book_id
    and (problem_types.unit_id, problem_types.concept_id, problem_types.name,
         problem_types.name_raw, problem_types.sort_order)
      is distinct from
        (excluded.unit_id, excluded.concept_id, excluded.name,
         excluded.name_raw, excluded.sort_order);

  insert into content.problems (
    id, book_id, unit_id, concept_id, problem_type_id, type_id,
    page_printed, number, image_path, answer, answer_key, public_payload,
    position_in_type, is_example, difficulty_hint, verified, metadata
  )
  select
    stage.problem_id,
    v_run.book_id,
    (stage.payload#>>'{problem,unit_id}')::uuid,
    nullif(stage.payload#>>'{problem,concept_id}', '')::uuid,
    nullif(stage.payload#>>'{problem,problem_type_id}', '')::uuid,
    nullif(stage.payload#>>'{problem,type_id}', '')::uuid,
    (stage.payload#>>'{problem,page_printed}')::integer,
    stage.payload#>>'{problem,number}',
    stage.payload#>>'{problem,image_path}',
    stage.payload#>'{problem,answer}',
    stage.payload#>'{problem,answer_key}',
    stage.payload#>'{problem,public_payload}',
    nullif(stage.payload#>>'{problem,position_in_type}', '')::integer,
    coalesce((stage.payload#>>'{problem,is_example}')::boolean, false),
    nullif(stage.payload#>>'{problem,difficulty_hint}', ''),
    true,
    stage.payload#>'{problem,metadata}'
  from content.studyq_import_stage_problems stage
  where stage.import_run_id = p_import_run_id
  on conflict (id) do update
  set unit_id = excluded.unit_id,
      concept_id = excluded.concept_id,
      problem_type_id = excluded.problem_type_id,
      type_id = excluded.type_id,
      page_printed = excluded.page_printed,
      number = excluded.number,
      image_path = excluded.image_path,
      answer = excluded.answer,
      answer_key = excluded.answer_key,
      public_payload = excluded.public_payload,
      position_in_type = excluded.position_in_type,
      is_example = excluded.is_example,
      difficulty_hint = excluded.difficulty_hint,
      verified = true,
      metadata = excluded.metadata,
      updated_at = now()
  where problems.book_id = excluded.book_id
    and (problems.unit_id, problems.concept_id, problems.problem_type_id,
         problems.type_id, problems.page_printed, problems.number,
         problems.image_path, problems.answer, problems.answer_key,
         problems.public_payload, problems.position_in_type, problems.is_example,
         problems.difficulty_hint, problems.verified, problems.metadata)
      is distinct from
        (excluded.unit_id, excluded.concept_id, excluded.problem_type_id,
         excluded.type_id, excluded.page_printed, excluded.number,
         excluded.image_path, excluded.answer, excluded.answer_key,
         excluded.public_payload, excluded.position_in_type, excluded.is_example,
         excluded.difficulty_hint, excluded.verified, excluded.metadata);

  insert into content.assets (
    id, book_id, problem_id, kind, storage_path, media_type, metadata
  )
  select
    (stage.payload#>>'{asset,id}')::uuid,
    v_run.book_id,
    stage.problem_id,
    coalesce(stage.payload#>>'{asset,kind}', 'problem_image'),
    stage.payload#>>'{asset,storage_path}',
    stage.payload#>>'{asset,media_type}',
    coalesce(stage.payload#>'{asset,metadata}', '{}'::jsonb)
  from content.studyq_import_stage_problems stage
  where stage.import_run_id = p_import_run_id
  on conflict (id) do update
  set storage_path = excluded.storage_path,
      media_type = excluded.media_type,
      metadata = excluded.metadata
  where assets.book_id = excluded.book_id
    and assets.problem_id = excluded.problem_id
    and assets.kind = excluded.kind
    and (assets.storage_path, assets.media_type, assets.metadata)
      is distinct from (excluded.storage_path, excluded.media_type, excluded.metadata);

  insert into content.problem_source_refs (
    academy_id, source_namespace, external_id, problem_id, source_file_name,
    source_file_sha256, source_page, bbox, content_sha256, metadata
  )
  select
    v_run.academy_id,
    'studyq',
    stage.external_id,
    stage.problem_id,
    stage.payload#>>'{source_ref,source_file_name}',
    stage.payload#>>'{source_ref,source_file_sha256}',
    nullif(stage.payload#>>'{source_ref,source_page}', '')::integer,
    stage.payload#>'{source_ref,bbox}',
    stage.content_sha256,
    coalesce(stage.payload#>'{source_ref,metadata}', '{}'::jsonb)
  from content.studyq_import_stage_problems stage
  where stage.import_run_id = p_import_run_id
  on conflict (academy_id, source_namespace, external_id) do update
  set source_file_name = excluded.source_file_name,
      source_file_sha256 = excluded.source_file_sha256,
      source_page = excluded.source_page,
      bbox = excluded.bbox,
      metadata = excluded.metadata
  where problem_source_refs.problem_id = excluded.problem_id
    and problem_source_refs.content_sha256 = excluded.content_sha256
    and (problem_source_refs.source_file_name, problem_source_refs.source_file_sha256,
         problem_source_refs.source_page, problem_source_refs.bbox,
         problem_source_refs.metadata)
      is distinct from
        (excluded.source_file_name, excluded.source_file_sha256,
         excluded.source_page, excluded.bbox, excluded.metadata);

  insert into content.problem_analysis_tags (
    problem_id, analysis_skill_id, taxonomy_revision_id, challenge_band,
    equivalence_key, source_kind, source_ref, confidence, review_status,
    reviewed_at, metadata
  )
  select
    stage.problem_id,
    skill.skill_id,
    v_taxonomy_revision_id,
    (stage.payload#>>'{tag,challenge_band}')::smallint,
    stage.payload#>>'{tag,equivalence_key}',
    'import',
    'studyq:' || stage.external_id,
    coalesce((stage.payload#>>'{tag,confidence}')::numeric, 1),
    'approved',
    v_run.approved_at,
    coalesce(stage.payload#>'{tag,metadata}', '{}'::jsonb)
  from content.studyq_import_stage_problems stage
  join content.studyq_import_stage_skills skill
    on skill.import_run_id = p_import_run_id
   and skill.code = stage.payload#>>'{tag,skill_code}'
  where stage.import_run_id = p_import_run_id
  on conflict on constraint problem_analysis_tags_pkey do update
  set analysis_skill_id = excluded.analysis_skill_id,
      challenge_band = excluded.challenge_band,
      equivalence_key = excluded.equivalence_key,
      source_kind = excluded.source_kind,
      source_ref = excluded.source_ref,
      confidence = excluded.confidence,
      review_status = excluded.review_status,
      reviewed_at = excluded.reviewed_at,
      metadata = excluded.metadata
  where (problem_analysis_tags.analysis_skill_id,
         problem_analysis_tags.challenge_band,
         problem_analysis_tags.equivalence_key,
         problem_analysis_tags.source_kind,
         problem_analysis_tags.source_ref,
         problem_analysis_tags.confidence,
         problem_analysis_tags.review_status,
         problem_analysis_tags.reviewed_at,
         problem_analysis_tags.metadata)
    is distinct from
        (excluded.analysis_skill_id, excluded.challenge_band,
         excluded.equivalence_key, excluded.source_kind, excluded.source_ref,
         excluded.confidence, excluded.review_status, excluded.reviewed_at,
         excluded.metadata);

  select count(*)
  into v_final_count
  from content.problems problem
  where problem.book_id = v_run.book_id;
  if v_final_count <> v_run.expected_bank_problem_count then
    raise exception using errcode = '40001', message = 'Final StudyQ bank count does not match the approved manifest.';
  end if;
  if exists (
    select 1
    from content.studyq_import_stage_problems stage
    where stage.import_run_id = p_import_run_id
      and (
        not exists (
          select 1
          from content.problems problem
          where problem.id = stage.problem_id
            and problem.book_id = v_run.book_id
            and problem.verified
            and problem.image_path = stage.payload#>>'{asset,storage_path}'
            and problem.metadata#>>'{studyq,content_sha256}' = stage.content_sha256
        )
        or not exists (
          select 1
          from content.assets asset
          where asset.id = (stage.payload#>>'{asset,id}')::uuid
            and asset.book_id = v_run.book_id
            and asset.problem_id = stage.problem_id
            and asset.storage_path = stage.payload#>>'{asset,storage_path}'
            and asset.metadata->>'sha256' = stage.payload#>>'{asset,metadata,sha256}'
        )
        or not exists (
          select 1
          from content.problem_source_refs source_ref
          where source_ref.academy_id = v_run.academy_id
            and source_ref.source_namespace = 'studyq'
            and source_ref.external_id = stage.external_id
            and source_ref.problem_id = stage.problem_id
            and source_ref.content_sha256 = stage.content_sha256
        )
        or not exists (
          select 1
          from content.problem_analysis_tags tag
          join content.analysis_skills skill on skill.id = tag.analysis_skill_id
          where tag.problem_id = stage.problem_id
            and tag.taxonomy_revision_id = v_taxonomy_revision_id
            and tag.review_status = 'approved'
            and skill.code = stage.payload#>>'{tag,skill_code}'
        )
      )
  ) then
    raise exception using errcode = '23514', message = 'Not every staged StudyQ problem became complete verified canonical content.';
  end if;

  v_visibility := case
    when v_run.publish_requested then 'catalog'
    else coalesce(v_book.metadata->>'visibility', 'import_staging')
  end;
  update content.books book
  set pipeline_version = v_run.pipeline_version,
      imported_at = now(),
      metadata = coalesce(book.metadata, '{}'::jsonb) || jsonb_build_object(
        'visibility', v_visibility,
        'source', 'studyq',
        'bundle_version', v_run.bundle_version,
        'latest_bundle_sha256', v_run.bundle_sha256,
        'imported_by', 'scripts/import-studyq-bank.mjs'
      )
  where book.id = v_run.book_id;

  update content.import_runs run
  set status = 'succeeded',
      stats = jsonb_build_object(
        'added', v_added_count,
        'unchanged', v_unchanged_count,
        'repaired', v_repaired_count,
        'conflicts', 0,
        'total', v_stage_count,
        'final_bank_problem_count', v_final_count,
        'taxonomy_revision_id', v_taxonomy_revision_id,
        'visibility', v_visibility
      ),
      error_message = null,
      finished_at = coalesce(run.finished_at, now())
  where run.id = p_import_run_id;

  if p_attempt_id is not null then
    update content.studyq_import_attempt_assets asset_attempt
    set upload_status = case when asset_attempt.existed_before then 'skipped_existing' else 'uploaded' end,
        uploaded_at = case when asset_attempt.existed_before then asset_attempt.uploaded_at else coalesce(asset_attempt.uploaded_at, now()) end,
        cleanup_status = 'not_needed',
        cleanup_error = null
    where asset_attempt.attempt_id = p_attempt_id
      and asset_attempt.cleanup_status <> 'deleted';

    update content.studyq_import_attempts attempt
    set status = 'committed',
        stats = attempt.stats || jsonb_build_object(
          'committed_at', now(),
          'bank_problem_count', v_final_count,
          'mutation_id', v_mutation_id
        ),
        error_message = null,
        finished_at = now()
    where attempt.id = p_attempt_id;
  end if;

  perform private.emit_lms_invalidation_v2(
    p_academy_id => v_run.academy_id,
    p_domains => array['assignments', 'learning'],
    p_entity_type => 'content.books',
    p_entity_ids => array[v_run.book_id::text],
    p_event_id => v_mutation_id
  );

  return query select
    v_added_count,
    v_unchanged_count,
    v_repaired_count,
    v_final_count,
    v_visibility,
    v_taxonomy_revision_id,
    v_mutation_id,
    v_was_succeeded;
end;
$$;

comment on function content.commit_studyq_import_v2(uuid, uuid) is
  'Serializes one staged StudyQ bundle per bank and atomically commits hierarchy, verified problems, provenance, taxonomy, expected count, and optional publication.';
revoke all on function content.commit_studyq_import_v2(uuid, uuid)
  from public, anon, authenticated;
grant execute on function content.commit_studyq_import_v2(uuid, uuid)
  to service_role;

create or replace function learning.expire_assignment_matches_v1(
  p_now timestamptz default now()
)
returns table (
  job_id uuid,
  batch_id uuid,
  file_path text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'Only the service role may expire assignment matches.';
  end if;
  if p_now is null then
    raise exception using errcode = '22023', message = 'p_now is required.';
  end if;

  return query
  with candidates as materialized (
    select job.id, job.batch_id, job.file_path
    from learning.assignment_match_jobs job
    where job.assignment_id is null
      and job.expires_at <= p_now
      and job.status not in ('assigned', 'cancelled', 'expired')
    order by job.expires_at, job.id
    for update skip locked
  ),
  expired_jobs as (
    update learning.assignment_match_jobs job
    set status = 'expired',
        revision = job.revision + 1,
        error_message = coalesce(job.error_message, 'Match job expired before assignment.')
    from candidates candidate
    where job.id = candidate.id
    returning job.id, job.batch_id, job.file_path
  ),
  expired_batches as (
    update learning.assignment_match_batches batch
    set status = 'expired'
    where batch.expires_at <= p_now
      and batch.status not in ('assigned', 'cancelled', 'expired')
      and not exists (
        select 1
        from learning.assignment_match_jobs assigned_sibling
        where assigned_sibling.batch_id = batch.id
          and assigned_sibling.assignment_id is not null
      )
      and not exists (
        select 1
        from learning.assignment_match_jobs sibling
        where sibling.batch_id = batch.id
          and sibling.assignment_id is null
          and sibling.status not in ('assigned', 'cancelled', 'expired')
          and sibling.id not in (select expired_job.id from expired_jobs expired_job)
      )
    returning batch.id
  )
  select expired_job.id, expired_job.batch_id, expired_job.file_path
  from expired_jobs expired_job
  order by expired_job.id;
end;
$$;

comment on function learning.expire_assignment_matches_v1(timestamptz) is
  'Atomically expires unassigned match jobs, skips rows held by another cleanup worker, and returns Storage paths for deletion.';
revoke all on function learning.expire_assignment_matches_v1(timestamptz)
  from public, anon, authenticated;
grant execute on function learning.expire_assignment_matches_v1(timestamptz)
  to service_role;

comment on table content.problem_source_refs is
  'Service-only authoritative mapping from external StudyQ problem codes to canonical problems.';
comment on table content.import_runs is
  'Service-only audit and idempotency record for approved StudyQ bundle imports.';
comment on table content.studyq_import_stage_problems is
  'Service-only per-run problem payloads consumed by the serialized StudyQ commit RPC.';
comment on table content.studyq_import_stage_skills is
  'Service-only per-run taxonomy skills consumed by the serialized StudyQ commit RPC.';
comment on table content.studyq_import_attempts is
  'Service-only audit for each importer process attempt, including retryable Storage cleanup state.';
comment on table content.studyq_import_attempt_assets is
  'Service-only before-upload evidence and reference-aware cleanup audit for deterministic StudyQ Storage paths.';
comment on table learning.assignment_match_batches is
  'Single or batch PDF code-matching operation owned by one academy.';
comment on table learning.assignment_match_jobs is
  'One student PDF and its assignment-finalization state.';
comment on table learning.assignment_match_items is
  'Ordered PDF code slots and their exact canonical problem matches.';
