-- The initial bank commit materializes 9,538 approved problems plus their
-- provenance, assets, and analysis tags in one transaction.  Keep the wider
-- timeout scoped to this service-only import RPC; interactive queries retain
-- the project's normal statement timeout.
alter function content.commit_studyq_import_v2(uuid, uuid)
  set statement_timeout = '10min';

comment on function content.commit_studyq_import_v2(uuid, uuid) is
  'Serializes one staged StudyQ bundle per bank and atomically commits hierarchy, verified problems, provenance, taxonomy, expected count, and optional publication. The service-only bulk commit has a 10-minute statement timeout.';
