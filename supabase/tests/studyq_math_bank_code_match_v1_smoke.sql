do $$
declare
  payload jsonb;
  storage_select_qual text;
  finalize_definition text;
  commit_definition text;
begin
  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'content.problem_types'::regclass
      and constraint_row.contype = 'u'
      and pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (book_id, unit_id, name)'
  ) then
    raise exception 'problem type uniqueness is not scoped to book/unit/name';
  end if;

  payload := content.problem_public_payload(
    '{"type":"choice","subs":[{"label":"(1)","type":"choice","choices":["1","2","3","4","5"]}]}'::jsonb
  );
  if payload #> '{subs,0,choices}' <> '["1","2","3","4","5"]'::jsonb then
    raise exception 'sub-question choices were removed from the public payload: %', payload;
  end if;
  if coalesce((payload->>'self_grade')::boolean, false)
     or coalesce((payload #>> '{subs,0,self_grade}')::boolean, false) then
    raise exception 'fixed-choice sub-questions were incorrectly marked self-grade: %', payload;
  end if;

  if has_table_privilege('authenticated', 'content.problem_source_refs', 'select')
     or has_table_privilege('authenticated', 'content.import_runs', 'select')
     or has_table_privilege('authenticated', 'content.studyq_import_stage_problems', 'select')
     or has_table_privilege('authenticated', 'content.studyq_import_stage_skills', 'select')
     or has_table_privilege('authenticated', 'content.studyq_import_attempts', 'select')
     or has_table_privilege('authenticated', 'content.studyq_import_attempt_assets', 'select') then
    raise exception 'service-only content import tables are exposed to authenticated';
  end if;
  if not has_table_privilege('service_role', 'content.problem_source_refs', 'select,insert,update,delete')
     or not has_table_privilege('service_role', 'content.import_runs', 'select,insert,update,delete')
     or not has_table_privilege('service_role', 'content.studyq_import_stage_problems', 'select,insert,update,delete')
     or not has_table_privilege('service_role', 'content.studyq_import_stage_skills', 'select,insert,update,delete')
     or not has_table_privilege('service_role', 'content.studyq_import_attempts', 'select,insert,update,delete')
     or not has_table_privilege('service_role', 'content.studyq_import_attempt_assets', 'select,insert,update,delete') then
    raise exception 'service role lacks import table privileges';
  end if;

  if has_function_privilege(
       'authenticated',
       'content.commit_studyq_import_v2(uuid,uuid)',
       'execute'
     ) then
    raise exception 'transactional StudyQ commit RPC is exposed to authenticated';
  end if;
  if not has_function_privilege(
       'service_role',
       'content.commit_studyq_import_v2(uuid,uuid)',
       'execute'
     ) then
    raise exception 'service role cannot execute transactional StudyQ commit RPC';
  end if;
  if has_function_privilege(
       'authenticated',
       'content.claim_studyq_import_asset_cleanup_v1(uuid,integer)',
       'execute'
     ) or not has_function_privilege(
       'service_role',
       'content.claim_studyq_import_asset_cleanup_v1(uuid,integer)',
       'execute'
     ) or has_function_privilege(
       'authenticated',
       'content.complete_studyq_import_asset_cleanup_v1(uuid,text[],boolean,text)',
       'execute'
     ) then
    raise exception 'StudyQ asset cleanup RPC grants are unsafe';
  end if;
  select pg_get_functiondef('content.commit_studyq_import_v2(uuid,uuid)'::regprocedure)
  into commit_definition;
  if position('pg_advisory_xact_lock' in commit_definition) = 0
     or position('v_current_count + v_added_count <> v_run.expected_bank_problem_count' in commit_definition) = 0
     or position('outside the publish_requested branch' in commit_definition) = 0 then
    raise exception 'StudyQ commit RPC lacks serialized unconditional expected-count enforcement';
  end if;

  if has_function_privilege(
       'authenticated',
       'learning.create_assignment_from_code_match_v1(uuid,uuid,integer,text,uuid)',
       'execute'
     ) then
    raise exception 'code-match finalize RPC is exposed to authenticated';
  end if;
  if not has_function_privilege(
       'service_role',
       'learning.create_assignment_from_code_match_v1(uuid,uuid,integer,text,uuid)',
       'execute'
     ) then
    raise exception 'service role cannot execute code-match finalize RPC';
  end if;
  if has_function_privilege(
       'authenticated',
       'learning.expire_assignment_matches_v1(timestamptz)',
       'execute'
     ) then
    raise exception 'match expiry RPC is exposed to authenticated';
  end if;

  if not exists (
    select 1
    from storage.buckets bucket
    where bucket.id = 'assignment-files'
      and not bucket.public
      and bucket.file_size_limit = 52428800
      and bucket.allowed_mime_types = array['application/pdf']::text[]
  ) then
    raise exception 'private assignment-files bucket contract is missing';
  end if;

  select policy.qual
  into storage_select_qual
  from pg_policies policy
  where policy.schemaname = 'storage'
    and policy.tablename = 'objects'
    and policy.policyname = 'assignment_files_objects_select';
  if storage_select_qual is null
     or position('student_visible' in storage_select_qual) = 0
     or position('application/pdf' in storage_select_qual) = 0
     or position('accessible_assignment_ids' in storage_select_qual) = 0 then
    raise exception 'student assignment PDF Storage filter is incomplete: %', storage_select_qual;
  end if;
  if exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.policyname in ('assignment_files_objects_update', 'assignment_files_objects_delete')
  ) then
    raise exception 'assignment-files Storage UPDATE/DELETE policy must not exist';
  end if;
  if exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'learning'
      and policy.tablename = 'assignment_files'
      and policy.roles @> array['authenticated'::name]
      and policy.cmd in ('UPDATE', 'DELETE', 'ALL')
  ) or has_table_privilege('authenticated', 'learning.assignment_files', 'update')
       or has_table_privilege('authenticated', 'learning.assignment_files', 'delete') then
    raise exception 'authenticated assignment file UPDATE/DELETE access must not exist';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'learning.assignment_match_jobs'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.confdeltype = 'n'
      and constraint_row.conkey = array[
        (select attribute.attnum::smallint
         from pg_attribute attribute
         where attribute.attrelid = 'learning.assignment_match_jobs'::regclass
           and attribute.attname = 'target_student_id')
      ]::smallint[]
  ) then
    raise exception 'target_student_id must use ON DELETE SET NULL';
  end if;
  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'learning.assignment_match_jobs'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.confdeltype = 'n'
      and constraint_row.conkey = array[
        (select attribute.attnum::smallint
         from pg_attribute attribute
         where attribute.attrelid = 'learning.assignment_match_jobs'::regclass
           and attribute.attname = 'assignment_id')
      ]::smallint[]
  ) then
    raise exception 'assignment_id must use ON DELETE SET NULL';
  end if;

  select pg_get_functiondef(
    'learning.create_assignment_from_code_match_v1(uuid,uuid,integer,text,uuid)'::regprocedure
  ) into finalize_definition;
  if position('finalized_assignment_id' in finalize_definition) = 0
     or position('original_target_student_id' in finalize_definition) = 0
     or position('student_visible' in finalize_definition) = 0 then
    raise exception 'finalize audit or student-visible file metadata is incomplete';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'learning'
      and column_row.table_name = 'assignment_match_jobs'
      and column_row.column_name = 'source_deleted_at'
      and column_row.data_type = 'timestamp with time zone'
  ) then
    raise exception 'source_deleted_at cleanup marker is missing';
  end if;
  if not exists (
    select 1
    from pg_indexes index_row
    where index_row.schemaname = 'learning'
      and index_row.indexname = 'learning_assignment_match_jobs_source_cleanup_idx'
      and position('(status = ''expired''::text)' in index_row.indexdef) > 0
      and position('(source_deleted_at IS NULL)' in index_row.indexdef) > 0
  ) then
    raise exception 'durable expired-source cleanup index is missing';
  end if;

  if exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('content', 'learning')
      and relation.relname in (
        'problem_source_refs', 'import_runs', 'assignment_match_batches',
        'studyq_import_stage_problems', 'studyq_import_stage_skills',
        'studyq_import_attempts', 'studyq_import_attempt_assets',
        'assignment_match_jobs', 'assignment_match_items'
      )
      and not relation.relrowsecurity
  ) then
    raise exception 'a StudyQ workflow table is missing RLS';
  end if;
end;
$$;
