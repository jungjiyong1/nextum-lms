begin;

select set_config('request.jwt.claim.role', 'service_role', true);

insert into core.academies (id, name)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'StudyQ concurrency smoke');

insert into content.books (
  id, academy_id, book_key, title, subject, grade, schema_version, metadata
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'nextum_math_bank',
  '넥섬 수학 문제은행',
  '수학',
  '중2·중3·고등',
  2,
  '{"visibility":"catalog"}'::jsonb
);

insert into storage.buckets (id, name, public)
values ('problem-images', 'problem-images', false)
on conflict (id) do nothing;

insert into storage.objects (bucket_id, name)
values
  ('problem-images', 'smoke/problem-1.png'),
  ('problem-images', 'smoke/problem-2.png');

create function pg_temp.studyq_smoke_payload(
  p_external_id text,
  p_problem_id text,
  p_asset_id uuid,
  p_asset_path text,
  p_bundle_sha text
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'external_id', p_external_id,
    'problem_id', p_problem_id,
    'content_sha256', repeat(case when p_external_id = '1000001' then '1' else '2' end, 64),
    'unit', jsonb_build_object(
      'id', '33333333-3333-4333-8333-333333333333',
      'unit_key', 'middle-2-geometry',
      'part_name', '중2',
      'name', '도형의 성질',
      'page_start', null,
      'page_end', null,
      'sort_order', 1,
      'metadata', jsonb_build_object(
        'course_code', 'middle-2', 'grade_code', 'm2', 'school_type', 'middle'
      )
    ),
    'concept', jsonb_build_object(
      'id', '44444444-4444-4444-8444-444444444444',
      'unit_id', '33333333-3333-4333-8333-333333333333',
      'name', '삼각형',
      'name_raw', null,
      'sort_order', 1,
      'detail', null
    ),
    'problem_type', jsonb_build_object(
      'id', '55555555-5555-4555-8555-555555555555',
      'unit_id', '33333333-3333-4333-8333-333333333333',
      'concept_id', '44444444-4444-4444-8444-444444444444',
      'name', '삼각형의 성질',
      'name_raw', null,
      'sort_order', 1
    ),
    'problem', jsonb_build_object(
      'id', p_problem_id,
      'unit_id', '33333333-3333-4333-8333-333333333333',
      'concept_id', '44444444-4444-4444-8444-444444444444',
      'problem_type_id', '55555555-5555-4555-8555-555555555555',
      'type_id', '55555555-5555-4555-8555-555555555555',
      'page_printed', 1,
      'number', p_external_id,
      'image_path', p_asset_path,
      'answer', jsonb_build_object('type', 'choice', 'correct_index', 0),
      'answer_key', jsonb_build_object('type', 'choice', 'correct_index', 0),
      'public_payload', jsonb_build_object('type', 'choice', 'choices', jsonb_build_array('1','2','3','4','5')),
      'position_in_type', 1,
      'is_example', false,
      'difficulty_hint', null,
      'metadata', jsonb_build_object(
        'studyq', jsonb_build_object(
          'source_namespace', 'studyq',
          'external_id', p_external_id,
          'content_sha256', repeat(case when p_external_id = '1000001' then '1' else '2' end, 64),
          'asset_sha256', repeat(case when p_external_id = '1000001' then '3' else '4' end, 64),
          'bundle_sha256', p_bundle_sha
        ),
        'verification', jsonb_build_object(
          'approved', true,
          'approved_by', 'smoke',
          'approved_at', '2026-07-12T00:00:00Z'
        )
      )
    ),
    'asset', jsonb_build_object(
      'id', p_asset_id,
      'bucket_id', 'problem-images',
      'problem_id', p_problem_id,
      'kind', 'problem_image',
      'storage_path', p_asset_path,
      'media_type', 'image/png',
      'metadata', jsonb_build_object(
        'source', 'studyq',
        'sha256', repeat(case when p_external_id = '1000001' then '3' else '4' end, 64),
        'bundle_sha256', p_bundle_sha
      )
    ),
    'source_ref', jsonb_build_object(
      'source_namespace', 'studyq',
      'external_id', p_external_id,
      'problem_id', p_problem_id,
      'source_file_name', 'smoke.pdf',
      'source_file_sha256', repeat('5', 64),
      'source_page', 1,
      'bbox', jsonb_build_array(0, 0, 10, 10),
      'content_sha256', repeat(case when p_external_id = '1000001' then '1' else '2' end, 64),
      'metadata', jsonb_build_object('bundle_sha256', p_bundle_sha)
    ),
    'tag', jsonb_build_object(
      'skill_code', 'SMOKE-GEO',
      'skill_id', '88888888-8888-4888-8888-888888888888',
      'challenge_band', 1,
      'equivalence_key', 'smoke-geometry',
      'confidence', 1,
      'metadata', jsonb_build_object('change_reason', 'StudyQ concurrency smoke')
    )
  )
$$;

insert into content.import_runs (
  id, academy_id, book_id, bundle_version, bundle_sha256, pipeline_version,
  import_mode, bundle_problem_count, expected_bank_problem_count,
  publish_requested, asset_bucket, approved_by, approved_at, approval_sha256,
  execution_sha
) values (
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'studyq-bank-bundle-v2', repeat('a', 64), 'smoke-v1',
  'incremental', 1, 1, false, 'problem-images', 'smoke', now(), repeat('b', 64),
  'smoke-execution-1'
);

insert into content.studyq_import_stage_skills (import_run_id, code, skill_id, payload)
values (
  '11111111-1111-4111-8111-111111111111',
  'SMOKE-GEO',
  '88888888-8888-4888-8888-888888888888',
  jsonb_build_object(
    'id', '88888888-8888-4888-8888-888888888888',
    'code', 'SMOKE-GEO',
    'subject', '수학',
    'school_type', 'middle',
    'grade', '중2',
    'semester', 1,
    'unit_code', 'middle-2-geometry',
    'unit_name', '도형의 성질',
    'name', '삼각형의 성질',
    'active', true,
    'sort_order', 1,
    'metadata', '{}'::jsonb
  )
);

insert into content.studyq_import_stage_problems (
  import_run_id, external_id, problem_id, content_sha256, payload
) values (
  '11111111-1111-4111-8111-111111111111',
  '1000001',
  '66666666-6666-4666-8666-666666666666',
  repeat('1', 64),
  pg_temp.studyq_smoke_payload(
    '1000001',
    '66666666-6666-4666-8666-666666666666',
    '77777777-7777-4777-8777-777777777777',
    'smoke/problem-1.png',
    repeat('a', 64)
  )
);

set local role service_role;
do $$
begin
  perform content.commit_studyq_import_v2('11111111-1111-4111-8111-111111111111');
end;
$$;
reset role;

do $$
begin
  if not exists (
    select 1 from content.problems
    where id = '66666666-6666-4666-8666-666666666666' and verified
  ) then
    raise exception 'first serialized StudyQ import did not commit';
  end if;
end;
$$;

insert into content.import_runs (
  id, academy_id, book_id, bundle_version, bundle_sha256, pipeline_version,
  import_mode, bundle_problem_count, expected_bank_problem_count,
  publish_requested, asset_bucket, approved_by, approved_at, approval_sha256,
  execution_sha
) values (
  '22222222-2222-4222-8222-222222222222',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'studyq-bank-bundle-v2', repeat('c', 64), 'smoke-v1',
  'incremental', 1, 1, false, 'problem-images', 'smoke', now(), repeat('d', 64),
  'smoke-execution-2'
);

insert into content.studyq_import_stage_skills (import_run_id, code, skill_id, payload)
select
  '22222222-2222-4222-8222-222222222222', code, skill_id, payload
from content.studyq_import_stage_skills
where import_run_id = '11111111-1111-4111-8111-111111111111';

insert into content.studyq_import_stage_problems (
  import_run_id, external_id, problem_id, content_sha256, payload
) values (
  '22222222-2222-4222-8222-222222222222',
  '1000002',
  '99999999-9999-4999-8999-999999999999',
  repeat('2', 64),
  pg_temp.studyq_smoke_payload(
    '1000002',
    '99999999-9999-4999-8999-999999999999',
    'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    'smoke/problem-2.png',
    repeat('c', 64)
  )
);

set local role service_role;
do $$
begin
  begin
    perform content.commit_studyq_import_v2('22222222-2222-4222-8222-222222222222');
    raise exception 'stale expected count unexpectedly committed';
  exception
    when serialization_failure then null;
  end;
end;
$$;
reset role;

do $$
begin
  if exists (
    select 1 from content.problems
    where id = '99999999-9999-4999-8999-999999999999'
  ) or exists (
    select 1 from content.problem_source_refs
    where academy_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and source_namespace = 'studyq'
      and external_id = '1000002'
  ) then
    raise exception 'stale concurrent increment left a partial canonical mutation';
  end if;
  if (select count(*) from content.problems where book_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 1 then
    raise exception 'stale concurrent increment changed the bank count';
  end if;
end;
$$;

rollback;
