-- The production compatibility migration predates the course metadata used by
-- the single StudyQ bank.  Keep the column additive and backfill-safe.
alter table content.units
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column content.units.metadata is
  'Course, grade, and school-type metadata for single-bank catalog routes.';
