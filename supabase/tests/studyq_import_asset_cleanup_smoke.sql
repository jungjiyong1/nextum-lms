begin;

select set_config('request.jwt.claim.role', 'service_role', true);

insert into core.academies (id, name)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'StudyQ cleanup smoke');

insert into content.books (id, academy_id, book_key, title, metadata)
values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'nextum_math_bank',
  '넥섬 수학 문제은행',
  '{"visibility":"catalog"}'::jsonb
);

insert into storage.buckets (id, name, public)
values ('problem-images', 'problem-images', false)
on conflict (id) do nothing;

insert into storage.objects (bucket_id, name)
values (
  'problem-images',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/nextum_math_bank/existing/existing.png'
);

insert into content.import_runs (
  id, academy_id, book_id, bundle_version, bundle_sha256, pipeline_version,
  import_mode, bundle_problem_count, expected_bank_problem_count,
  asset_bucket, approved_by, approved_at, approval_sha256, execution_sha
) values (
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'studyq-bank-bundle-v2', repeat('1', 64), 'cleanup-smoke-v1',
  'incremental', 1, 1, 'problem-images', 'smoke', now(), repeat('a', 64), 'cleanup-smoke-a'
);

insert into content.studyq_import_attempts (id, import_run_id)
values ('21111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111');

set local role service_role;
do $$
declare
  new_should_upload boolean;
  existing_should_upload boolean;
begin
  select registration.should_upload into new_should_upload
  from content.register_studyq_import_asset_attempt_v1(
    '21111111-1111-4111-8111-111111111111',
    array[
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/nextum_math_bank/new/new.png',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/nextum_math_bank/existing/existing.png'
    ]
  ) registration
  where registration.storage_path like '%/new/new.png';

  select registration.should_upload into existing_should_upload
  from content.register_studyq_import_asset_attempt_v1(
    '21111111-1111-4111-8111-111111111111',
    array[
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/nextum_math_bank/new/new.png',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/nextum_math_bank/existing/existing.png'
    ]
  ) registration
  where registration.storage_path like '%/existing/existing.png';

  if new_should_upload is distinct from true or existing_should_upload is distinct from false then
    raise exception 'before-upload existence audit is incorrect: new %, existing %', new_should_upload, existing_should_upload;
  end if;
end;
$$;
reset role;

insert into storage.objects (bucket_id, name)
values (
  'problem-images',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/nextum_math_bank/new/new.png'
);
update content.studyq_import_attempts set status = 'failed' where id = '21111111-1111-4111-8111-111111111111';
update content.import_runs set status = 'failed' where id = '11111111-1111-4111-8111-111111111111';

-- A second active run references the same path. Cleanup must retain it.
insert into content.import_runs (
  id, academy_id, book_id, bundle_version, bundle_sha256, pipeline_version,
  import_mode, bundle_problem_count, expected_bank_problem_count,
  asset_bucket, approved_by, approved_at, approval_sha256, execution_sha
) values (
  '22222222-2222-4222-8222-222222222222',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'studyq-bank-bundle-v2', repeat('2', 64), 'cleanup-smoke-v1',
  'incremental', 1, 1, 'problem-images', 'smoke', now(), repeat('b', 64), 'cleanup-smoke-b'
);
insert into content.studyq_import_attempts (id, import_run_id)
values ('32222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222');
insert into content.studyq_import_stage_problems (
  import_run_id, external_id, problem_id, content_sha256, payload
) values (
  '22222222-2222-4222-8222-222222222222',
  '1000002',
  'cleanup-smoke-problem-2',
  repeat('c', 64),
  jsonb_build_object(
    'asset', jsonb_build_object(
      'storage_path', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/nextum_math_bank/new/new.png'
    )
  )
);

set local role service_role;
do $$
begin
  if exists (
    select 1
    from content.claim_studyq_import_asset_cleanup_v1(
      '21111111-1111-4111-8111-111111111111', 1000
    )
  ) then
    raise exception 'cleanup claimed a path referenced by another active run';
  end if;
end;
$$;
reset role;

update content.studyq_import_attempts set status = 'failed' where id = '32222222-2222-4222-8222-222222222222';
update content.import_runs set status = 'failed' where id = '22222222-2222-4222-8222-222222222222';

set local role service_role;
do $$
declare
  claimed_paths text[];
  retried_claimed_paths text[];
begin
  select coalesce(array_agg(cleanup.storage_path), array[]::text[])
  into claimed_paths
  from content.claim_studyq_import_asset_cleanup_v1(
    '32222222-2222-4222-8222-222222222222', 1000
  ) cleanup;
  if claimed_paths <> array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/nextum_math_bank/new/new.png']::text[] then
    raise exception 'cleanup did not claim exactly the attempt-created orphan: %', claimed_paths;
  end if;
  select coalesce(array_agg(cleanup.storage_path), array[]::text[])
  into retried_claimed_paths
  from content.claim_studyq_import_asset_cleanup_v1(
    '32222222-2222-4222-8222-222222222222', 1000
  ) cleanup;
  if retried_claimed_paths <> claimed_paths then
    raise exception 'lost-response cleanup claim was not idempotent: first %, retry %', claimed_paths, retried_claimed_paths;
  end if;
end;
$$;
reset role;

-- A claimed path cannot gain a new canonical reference or be reused by a new
-- importer attempt while the Storage API delete is in flight.
do $$
begin
  begin
    insert into content.assets (id, kind, storage_path)
    values (
      '44444444-4444-4444-8444-444444444444',
      'problem_image',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/nextum_math_bank/new/new.png'
    );
    raise exception 'claimed path unexpectedly accepted a canonical content.assets reference';
  exception when object_not_in_prerequisite_state then null;
  end;
end;
$$;

insert into content.import_runs (
  id, academy_id, book_id, bundle_version, bundle_sha256, pipeline_version,
  import_mode, bundle_problem_count, expected_bank_problem_count,
  asset_bucket, approved_by, approved_at, approval_sha256, execution_sha
) values (
  '33333333-3333-4333-8333-333333333333',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'studyq-bank-bundle-v2', repeat('3', 64), 'cleanup-smoke-v1',
  'incremental', 1, 1, 'problem-images', 'smoke', now(), repeat('d', 64), 'cleanup-smoke-c'
);
insert into content.studyq_import_attempts (id, import_run_id)
values ('43333333-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333');

set local role service_role;
do $$
begin
  begin
    perform content.register_studyq_import_asset_attempt_v1(
      '43333333-3333-4333-8333-333333333333',
      array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/nextum_math_bank/new/new.png']
    );
    raise exception 'new attempt unexpectedly reused a cleanup-claimed path';
  exception when object_not_in_prerequisite_state then null;
  end;
end;
$$;

-- A failed Storage API response remains audited and can be claimed again.
select *
from content.complete_studyq_import_asset_cleanup_v1(
  '32222222-2222-4222-8222-222222222222',
  array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/nextum_math_bank/new/new.png'],
  false,
  'simulated Storage API failure'
);
do $$
begin
  if not exists (
    select 1
    from content.studyq_import_attempt_assets
    where cleanup_claimed_by = '32222222-2222-4222-8222-222222222222'
      and cleanup_status = 'failed'
      and cleanup_error like 'simulated%'
  ) then
    raise exception 'failed cleanup was not retained for audit/retry';
  end if;
  if not exists (
    select 1
    from content.claim_studyq_import_asset_cleanup_v1(
      '32222222-2222-4222-8222-222222222222', 1000
    )
  ) then
    raise exception 'failed cleanup was not retryable';
  end if;
end;
$$;
reset role;

-- An object that was new to an attempt but is now referenced by content.assets
-- is retained and never returned to the Storage remover.
insert into content.import_runs (
  id, academy_id, book_id, bundle_version, bundle_sha256, pipeline_version,
  import_mode, bundle_problem_count, expected_bank_problem_count,
  asset_bucket, approved_by, approved_at, approval_sha256, execution_sha
) values (
  '55555555-5555-4555-8555-555555555555',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'studyq-bank-bundle-v2', repeat('4', 64), 'cleanup-smoke-v1',
  'incremental', 1, 1, 'problem-images', 'smoke', now(), repeat('e', 64), 'cleanup-smoke-d'
);
insert into content.studyq_import_attempts (id, import_run_id)
values ('65555555-5555-4555-8555-555555555555', '55555555-5555-4555-8555-555555555555');
set local role service_role;
select *
from content.register_studyq_import_asset_attempt_v1(
  '65555555-5555-4555-8555-555555555555',
  array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/nextum_math_bank/canonical/canonical.png']
);
reset role;
insert into storage.objects (bucket_id, name)
values (
  'problem-images',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/nextum_math_bank/canonical/canonical.png'
);
insert into content.assets (id, kind, storage_path)
values (
  '75555555-5555-4555-8555-555555555555',
  'problem_image',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/nextum_math_bank/canonical/canonical.png'
);
update content.studyq_import_attempts set status = 'failed' where id = '65555555-5555-4555-8555-555555555555';
update content.import_runs set status = 'failed' where id = '55555555-5555-4555-8555-555555555555';
set local role service_role;
do $$
begin
  if exists (
    select 1
    from content.claim_studyq_import_asset_cleanup_v1(
      '65555555-5555-4555-8555-555555555555', 1000
    )
  ) then
    raise exception 'cleanup claimed a path referenced by content.assets';
  end if;
end;
$$;
reset role;

rollback;
