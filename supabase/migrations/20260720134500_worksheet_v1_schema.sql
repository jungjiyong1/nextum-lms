-- Worksheet v1 schema: per-student worksheet drafts, variants, items, render
-- jobs, artifacts, recommendation logs, problem-bank academy grants, and
-- problem-image render metadata.
--
-- Access model: every worksheet table is service-role only (deny-all RLS like
-- the StudyQ import tables). The LMS server is the sole reader/writer; Grade
-- App never reads worksheet tables because publishing materializes each
-- variant into the existing learning.assignments contract.
-- This migration contains no tenant data. Pilot-academy grants are issued
-- through the admin approval UI, never through migrations.

-- ---------------------------------------------------------------------------
-- content.assets render metadata (backfilled by script; nullable until then)

alter table content.assets
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists byte_size bigint,
  add column if not exists sha256 text,
  add column if not exists logical_dpi numeric;

alter table content.assets
  add constraint content_assets_width_positive_check
    check (width is null or width > 0),
  add constraint content_assets_height_positive_check
    check (height is null or height > 0),
  add constraint content_assets_byte_size_positive_check
    check (byte_size is null or byte_size > 0),
  add constraint content_assets_sha256_format_check
    check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  add constraint content_assets_logical_dpi_positive_check
    check (logical_dpi is null or logical_dpi > 0);

-- ---------------------------------------------------------------------------
-- Problem-bank academy access grants

create table content.problem_bank_grants (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references core.academies (id) on delete cascade,
  book_id     uuid references content.books (id) on delete cascade,
  status      text not null default 'active' check (status in ('active', 'revoked')),
  granted_by  uuid references core.people (id) on delete set null,
  note        text,
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (note is null or length(note) <= 500),
  check (status <> 'active' or revoked_at is null)
);

-- book_id null grants the whole bank to the academy; a row per book narrows it.
create unique index content_problem_bank_grants_bank_key
  on content.problem_bank_grants (academy_id)
  where book_id is null;
create unique index content_problem_bank_grants_book_key
  on content.problem_bank_grants (academy_id, book_id)
  where book_id is not null;
create index content_problem_bank_grants_book_idx
  on content.problem_bank_grants (book_id)
  where book_id is not null;

-- ---------------------------------------------------------------------------
-- Worksheet drafts (one creation session; 1:1 variant for the single-student
-- flow, 1:N for the class batch flow)

create table learning.worksheet_drafts (
  id                   uuid primary key default gen_random_uuid(),
  academy_id           uuid not null references core.academies (id) on delete cascade,
  class_id             uuid references core.classes (id) on delete set null,
  created_by           uuid references core.people (id) on delete set null,
  status               text not null default 'draft'
                       check (status in ('draft', 'rendering', 'ready', 'published', 'void')),
  selection_seed       text not null,
  layout_version       integer not null default 1 check (layout_version > 0),
  render_revision      integer not null default 1 check (render_revision > 0),
  settings_snapshot    jsonb not null default '{}'::jsonb,
  -- Eligibility state captured at publish time; metrics must not recompute it
  -- later because eligibility is otherwise derived on the fly.
  eligibility_snapshot jsonb,
  cart_opened_at       timestamptz,
  render_requested_at  timestamptz,
  published_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (btrim(selection_seed) <> '' and length(selection_seed) <= 100),
  check (jsonb_typeof(settings_snapshot) = 'object'),
  check (eligibility_snapshot is null or jsonb_typeof(eligibility_snapshot) = 'object'),
  check (status <> 'published' or published_at is not null)
);

create index learning_worksheet_drafts_academy_status_idx
  on learning.worksheet_drafts (academy_id, status, created_at desc);
create index learning_worksheet_drafts_class_idx
  on learning.worksheet_drafts (class_id)
  where class_id is not null;
create index learning_worksheet_drafts_created_by_idx
  on learning.worksheet_drafts (created_by)
  where created_by is not null;

-- ---------------------------------------------------------------------------
-- Worksheet variants (one student's printed worksheet)

create table learning.worksheet_variants (
  id            uuid primary key default gen_random_uuid(),
  draft_id      uuid not null references learning.worksheet_drafts (id) on delete cascade,
  academy_id    uuid not null references core.academies (id) on delete cascade,
  student_id    uuid not null references core.students (id) on delete cascade,
  version_code  text not null,
  status        text not null default 'draft'
                check (status in ('draft', 'rendering', 'ready', 'published', 'void', 'failed')),
  -- Frozen at publish: layout_version, item order, problem ids, image hashes,
  -- answer snapshots, roles. Immutable once the variant is published.
  manifest      jsonb,
  -- Published variants materialize into the existing per-student assignment
  -- contract; Grade App only ever sees that assignment.
  assignment_id uuid unique references learning.assignments (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (draft_id, student_id),
  unique (academy_id, version_code),
  check (version_code ~ '^[A-Z0-9][A-Z0-9-]{3,19}$'),
  check (manifest is null or jsonb_typeof(manifest) = 'object'),
  check (status <> 'published' or (manifest is not null and assignment_id is not null))
);

create index learning_worksheet_variants_student_idx
  on learning.worksheet_variants (student_id, created_at desc);
create index learning_worksheet_variants_academy_idx
  on learning.worksheet_variants (academy_id, status);

-- ---------------------------------------------------------------------------
-- Worksheet items (one problem slot; the smallest unit of evidence semantics)

create table learning.worksheet_items (
  id                      uuid primary key default gen_random_uuid(),
  variant_id              uuid not null references learning.worksheet_variants (id) on delete cascade,
  academy_id              uuid not null references core.academies (id) on delete cascade,
  seq                     integer not null check (seq > 0),
  problem_id              text not null references content.problems (id) on delete restrict,
  analysis_skill_id       uuid references content.analysis_skills (id) on delete set null,
  challenge_band_snapshot smallint
                          check (challenge_band_snapshot is null
                                 or challenge_band_snapshot between 1 and 4),
  answer_snapshot         jsonb,
  image_sha256            text check (image_sha256 is null or image_sha256 ~ '^[0-9a-f]{64}$'),
  role                    text not null
                          check (role in ('verification', 'practice', 'review', 'exam_prep', 'teacher_added')),
  evidence_eligible       boolean not null default false,
  -- Starts equal to problem_id; confirmed clones are merged manually later.
  similarity_group_id     text not null,
  concept_asset_id        uuid references content.assets (id) on delete set null,
  -- Filled at publish with the materialized learning.assignment_items row so
  -- evidence queries can join worksheet roles onto real attempts.
  assignment_item_id      uuid unique references learning.assignment_items (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (variant_id, seq),
  unique (variant_id, problem_id),
  check (btrim(similarity_group_id) <> ''),
  check (answer_snapshot is null or jsonb_typeof(answer_snapshot) = 'object'),
  check (not evidence_eligible or role in ('verification', 'review', 'exam_prep'))
);

create index learning_worksheet_items_academy_problem_idx
  on learning.worksheet_items (academy_id, problem_id);
create index learning_worksheet_items_skill_idx
  on learning.worksheet_items (analysis_skill_id)
  where analysis_skill_id is not null;
create index learning_worksheet_items_concept_asset_idx
  on learning.worksheet_items (concept_asset_id)
  where concept_asset_id is not null;

-- ---------------------------------------------------------------------------
-- Render artifacts (student PDFs, answer keys, batch ZIPs)

create table learning.worksheet_artifacts (
  id              uuid primary key default gen_random_uuid(),
  academy_id      uuid not null references core.academies (id) on delete cascade,
  draft_id        uuid not null references learning.worksheet_drafts (id) on delete cascade,
  variant_id      uuid references learning.worksheet_variants (id) on delete cascade,
  kind            text not null check (kind in ('student_pdf', 'answer_key', 'zip')),
  render_revision integer not null check (render_revision > 0),
  storage_bucket  text not null default 'worksheet-artifacts',
  storage_path    text not null,
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size       bigint not null check (byte_size > 0),
  page_count      integer check (page_count is null or page_count > 0),
  created_at      timestamptz not null default now(),
  check (btrim(storage_bucket) <> ''),
  check (btrim(storage_path) <> ''),
  check ((kind = 'student_pdf') = (variant_id is not null))
);

create unique index learning_worksheet_artifacts_identity_key
  on learning.worksheet_artifacts (
    draft_id,
    render_revision,
    kind,
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index learning_worksheet_artifacts_variant_idx
  on learning.worksheet_artifacts (variant_id)
  where variant_id is not null;
create index learning_worksheet_artifacts_academy_idx
  on learning.worksheet_artifacts (academy_id);

-- ---------------------------------------------------------------------------
-- Render jobs (asynchronous, idempotent, duplicate-delivery safe)

create table learning.worksheet_render_jobs (
  id              uuid primary key default gen_random_uuid(),
  academy_id      uuid not null references core.academies (id) on delete cascade,
  draft_id        uuid not null references learning.worksheet_drafts (id) on delete cascade,
  variant_id      uuid references learning.worksheet_variants (id) on delete cascade,
  kind            text not null check (kind in ('student_pdf', 'answer_key', 'zip')),
  render_revision integer not null check (render_revision > 0),
  idempotency_key text not null,
  status          text not null default 'queued'
                  check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts        integer not null default 0 check (attempts >= 0),
  error_message   text,
  artifact_id     uuid references learning.worksheet_artifacts (id) on delete set null,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (academy_id, idempotency_key),
  check (btrim(idempotency_key) <> '' and length(idempotency_key) <= 200),
  check ((kind = 'student_pdf') = (variant_id is not null)),
  check (status <> 'succeeded' or artifact_id is not null)
);

create index learning_worksheet_render_jobs_queue_idx
  on learning.worksheet_render_jobs (status, created_at)
  where status in ('queued', 'running');
create index learning_worksheet_render_jobs_draft_idx
  on learning.worksheet_render_jobs (draft_id);
create index learning_worksheet_render_jobs_variant_idx
  on learning.worksheet_render_jobs (variant_id)
  where variant_id is not null;
create index learning_worksheet_render_jobs_artifact_idx
  on learning.worksheet_render_jobs (artifact_id)
  where artifact_id is not null;

-- ---------------------------------------------------------------------------
-- Recommendation decision log (pilot metrics depend on this from day one)

create table learning.worksheet_recommendation_logs (
  id                uuid primary key default gen_random_uuid(),
  academy_id        uuid not null references core.academies (id) on delete cascade,
  draft_id          uuid not null references learning.worksheet_drafts (id) on delete cascade,
  variant_id        uuid references learning.worksheet_variants (id) on delete cascade,
  student_id        uuid references core.students (id) on delete set null,
  analysis_skill_id uuid references content.analysis_skills (id) on delete set null,
  problem_id        text references content.problems (id) on delete set null,
  event             text not null
                    check (event in ('proposed', 'kept', 'replaced', 'removed', 'force_included')),
  role              text check (role is null
                                or role in ('verification', 'practice', 'review', 'exam_prep', 'teacher_added')),
  reason_code       text,
  reason_text       text check (reason_text is null or length(reason_text) <= 500),
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  check (reason_code is null or btrim(reason_code) <> ''),
  check (jsonb_typeof(metadata) = 'object')
);

create index learning_worksheet_recommendation_logs_draft_idx
  on learning.worksheet_recommendation_logs (draft_id, created_at);
create index learning_worksheet_recommendation_logs_student_idx
  on learning.worksheet_recommendation_logs (student_id, created_at)
  where student_id is not null;
create index learning_worksheet_recommendation_logs_variant_idx
  on learning.worksheet_recommendation_logs (variant_id)
  where variant_id is not null;
create index learning_worksheet_recommendation_logs_skill_idx
  on learning.worksheet_recommendation_logs (analysis_skill_id)
  where analysis_skill_id is not null;
create index learning_worksheet_recommendation_logs_problem_idx
  on learning.worksheet_recommendation_logs (problem_id)
  where problem_id is not null;

-- ---------------------------------------------------------------------------
-- updated_at triggers (baseline convention)

create trigger set_problem_bank_grants_updated_at
  before update on content.problem_bank_grants
  for each row execute function core.set_updated_at();
create trigger set_worksheet_drafts_updated_at
  before update on learning.worksheet_drafts
  for each row execute function core.set_updated_at();
create trigger set_worksheet_variants_updated_at
  before update on learning.worksheet_variants
  for each row execute function core.set_updated_at();
create trigger set_worksheet_items_updated_at
  before update on learning.worksheet_items
  for each row execute function core.set_updated_at();
create trigger set_worksheet_render_jobs_updated_at
  before update on learning.worksheet_render_jobs
  for each row execute function core.set_updated_at();

-- ---------------------------------------------------------------------------
-- Access control: deny-all RLS, service-role only.
-- Like the StudyQ import tables, "RLS enabled without policies" is intentional
-- here; do not "fix" it by adding policies for regular roles.

alter table content.problem_bank_grants enable row level security;
alter table learning.worksheet_drafts enable row level security;
alter table learning.worksheet_variants enable row level security;
alter table learning.worksheet_items enable row level security;
alter table learning.worksheet_artifacts enable row level security;
alter table learning.worksheet_render_jobs enable row level security;
alter table learning.worksheet_recommendation_logs enable row level security;

revoke all on table
  content.problem_bank_grants,
  learning.worksheet_drafts,
  learning.worksheet_variants,
  learning.worksheet_items,
  learning.worksheet_artifacts,
  learning.worksheet_render_jobs,
  learning.worksheet_recommendation_logs
from public, anon, authenticated;

grant all privileges on table
  content.problem_bank_grants,
  learning.worksheet_drafts,
  learning.worksheet_variants,
  learning.worksheet_items,
  learning.worksheet_artifacts,
  learning.worksheet_render_jobs,
  learning.worksheet_recommendation_logs
to service_role;
