-- Growth-oriented, forward-only Supabase optimization contract.
--
-- Compatibility guarantees:
--   * legacy learning content tables and Grade App read paths remain intact;
--   * v1 Realtime triggers/events remain intact;
--   * existing public can_access_* function signatures remain available;
--   * all new APIs are additive and explicitly privilege-gated.

-- ---------------------------------------------------------------------------
-- Private caller-context helpers

create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.current_actor()
returns table (account_id uuid, person_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select ua.id, ua.person_id
  from core.user_accounts ua
  where (select auth.uid()) is not null
    and ua.auth_user_id = (select auth.uid())
    and ua.status = 'active'
  limit 1
$$;

create or replace function private.current_academy_ids(p_allowed_roles text[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with actor as materialized (
    select * from private.current_actor()
  )
  select am.academy_id
  from actor
  join core.academy_members am
    on am.user_account_id = actor.account_id
  where am.active
    and am.role = any(coalesce(p_allowed_roles, array[]::text[]))
  union
  select am.academy_id
  from actor
  join core.academy_members am
    on am.person_id = actor.person_id
  where am.active
    and am.role = any(coalesce(p_allowed_roles, array[]::text[]))
$$;

create or replace function private.current_student_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct s.id
  from private.current_actor() actor
  join core.students s on s.person_id = actor.person_id
  join core.academy_members member
    on member.academy_id = s.academy_id
   and member.active
   and member.role = 'student'
   and (
     member.user_account_id = actor.account_id
     or member.person_id = actor.person_id
   )
  where s.status = 'active'
$$;

create or replace function private.current_student_academy_pairs()
returns table (student_id uuid, academy_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct s.id, s.academy_id
  from private.current_actor() actor
  join core.students s on s.person_id = actor.person_id
  join core.academy_members member
    on member.academy_id = s.academy_id
   and member.active
   and member.role = 'student'
   and (
     member.user_account_id = actor.account_id
     or member.person_id = actor.person_id
   )
  where s.status = 'active'
$$;

create or replace function private.current_student_class_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct cs.class_id
  from core.class_students cs
  join core.classes c on c.id = cs.class_id and c.active
  join private.current_student_academy_pairs() student
    on student.student_id = cs.student_id
   and student.academy_id = c.academy_id
  where cs.status = 'active'
$$;

create or replace function private.current_assigned_class_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with actor as materialized (
    select * from private.current_actor()
  ),
  instructor_academies as materialized (
    select private.current_academy_ids(array['teacher', 'instructor']) as academy_id
  )
  select distinct c.id
  from actor
  join core.staff_members sm
    on sm.person_id = actor.person_id
   and sm.status = 'active'
  join instructor_academies ia on ia.academy_id = sm.academy_id
  join core.classes c on c.academy_id = sm.academy_id and c.active
  where exists (
      select 1
      from lms.class_profiles cp
      where cp.class_id = c.id
        and cp.status = 'active'
        and cp.default_instructor_staff_id = sm.id
    )
    or exists (
      select 1
      from lms.class_schedule_rules csr
      where csr.class_id = c.id
        and csr.active
        and csr.instructor_staff_id = sm.id
        and csr.start_date <= current_date
        and (csr.end_date is null or csr.end_date >= current_date)
    )
$$;

create or replace function private.current_instructor_staff_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct sm.id
  from private.current_actor() actor
  join core.staff_members sm
    on sm.person_id = actor.person_id
   and sm.status = 'active'
  where sm.academy_id in (
    select private.current_academy_ids(array['teacher', 'instructor'])
  )
$$;

create or replace function private.current_staff_class_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from core.classes c
  where c.academy_id in (
    select private.current_academy_ids(array['owner', 'admin', 'staff'])
  )
$$;

create or replace function private.accessible_student_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_student_ids()
  union
  select s.id
  from core.students s
  where s.academy_id in (
    select private.current_academy_ids(array['owner', 'admin', 'staff'])
  )
  union
  select cs.student_id
  from core.class_students cs
  where cs.status = 'active'
    and cs.class_id in (select private.current_assigned_class_ids())
$$;

create or replace function private.current_staff_assignment_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from learning.assignments a
  where a.academy_id in (
    select private.current_academy_ids(array['owner', 'admin', 'staff'])
  )
$$;

create or replace function private.current_staff_book_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with staff_academies as materialized (
    select private.current_academy_ids(array['owner', 'admin', 'staff']) as academy_id
  )
  select b.id
  from content.books b
  where b.academy_id in (select academy_id from staff_academies)
     or (
       b.academy_id is null
       and exists (select 1 from staff_academies)
     )
  union
  select ba.book_id
  from learning.book_assignments ba
  where ba.active
    and ba.academy_id in (select academy_id from staff_academies)
  union
  select a.book_id
  from learning.assignments a
  where a.academy_id in (select academy_id from staff_academies)
$$;

create or replace function private.accessible_assignment_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with staff_academies as materialized (
    select private.current_academy_ids(array['owner', 'admin', 'staff']) as academy_id
  ),
  instructor_academies as materialized (
    select private.current_academy_ids(array['teacher', 'instructor']) as academy_id
  ),
  own_students as materialized (
    select student_id, academy_id
    from private.current_student_academy_pairs()
  ),
  assigned_classes as materialized (
    select private.current_assigned_class_ids() as class_id
  ),
  instructor_students as materialized (
    select distinct cs.student_id
    from core.class_students cs
    join assigned_classes ac on ac.class_id = cs.class_id
    where cs.status = 'active'
  ),
  published_assignments as materialized (
    select a.id, a.academy_id
    from learning.assignments a
    where coalesce(a.active, true)
      and coalesce(a.status, 'published') = 'published'
      and coalesce(a.available_from, '-infinity'::timestamptz) <= now()
  )
  select a.id
  from learning.assignments a
  join staff_academies sa on sa.academy_id = a.academy_id
  union
  select pa.id
  from published_assignments pa
  join learning.assignment_recipients r
    on r.assignment_id = pa.id
   and r.active
  join own_students os
    on os.student_id = r.student_id
   and os.academy_id = pa.academy_id
  union
  select pa.id
  from published_assignments pa
  join instructor_academies ia on ia.academy_id = pa.academy_id
  join learning.assignment_recipients r
    on r.assignment_id = pa.id
   and r.active
  where r.class_id in (select class_id from assigned_classes)
     or r.student_id in (select student_id from instructor_students)
  union
  select pa.id
  from published_assignments pa
  join instructor_academies ia on ia.academy_id = pa.academy_id
  join learning.assignment_targets t
    on t.assignment_id = pa.id
   and coalesce(t.active, true)
   and t.target_type = 'class'
  where t.class_id in (select class_id from assigned_classes)
$$;

create or replace function private.submittable_assignment_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct a.id
  from learning.assignments a
  join learning.assignment_recipients r
    on r.assignment_id = a.id
   and r.active
  join private.current_student_academy_pairs() student
    on student.student_id = r.student_id
   and student.academy_id = a.academy_id
  where coalesce(a.active, true)
    and coalesce(a.status, 'published') = 'published'
    and coalesce(a.available_from, '-infinity'::timestamptz) <= now()
    and (a.due_at is null or now() <= a.due_at)
$$;

create or replace function private.accessible_book_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with staff_academies as materialized (
    select private.current_academy_ids(array['owner', 'admin', 'staff']) as academy_id
  ),
  own_students as materialized (
    select student_id, academy_id
    from private.current_student_academy_pairs()
  ),
  student_classes as materialized (
    select private.current_student_class_ids() as class_id
  ),
  assigned_classes as materialized (
    select private.current_assigned_class_ids() as class_id
  )
  select private.current_staff_book_ids()
  union
  select a.book_id
  from learning.assignments a
  where a.id in (select private.accessible_assignment_ids())
  union
  select ba.book_id
  from learning.book_assignments ba
  where ba.active
    and (
      ba.academy_id in (select academy_id from staff_academies)
      or (
        ba.target_type = 'student'
        and (ba.student_id, ba.academy_id) in (
          select student_id, academy_id from own_students
        )
      )
      or (ba.target_type = 'class' and ba.class_id in (select class_id from student_classes))
      or (ba.target_type = 'class' and ba.class_id in (select class_id from assigned_classes))
    )
$$;

create or replace function private.accessible_problem_ids()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  with accessible_assignments as materialized (
    select a.id, a.book_id, a.unit_id, a.problem_id
    from learning.assignments a
    where a.id in (select private.accessible_assignment_ids())
  )
  select p.id
  from content.problems p
  where p.book_id in (select private.current_staff_book_ids())
  union
  select item.problem_id
  from learning.assignment_items item
  join accessible_assignments aa on aa.id = item.assignment_id
  where item.problem_id is not null
  union
  select p.id
  from accessible_assignments aa
  join content.problems p
    on p.book_id = aa.book_id
   and (aa.unit_id is null or aa.unit_id = p.unit_id)
   and (aa.problem_id is null or aa.problem_id = p.id)
  where not exists (
    select 1
    from learning.assignment_items item
    where item.assignment_id = aa.id
  )
$$;

-- Private helpers are callable by policies but are not in an exposed API schema.
revoke all on function private.current_actor() from public, anon;
revoke all on function private.current_academy_ids(text[]) from public, anon;
revoke all on function private.current_student_ids() from public, anon;
revoke all on function private.current_student_academy_pairs() from public, anon;
revoke all on function private.current_student_class_ids() from public, anon;
revoke all on function private.current_assigned_class_ids() from public, anon;
revoke all on function private.current_instructor_staff_ids() from public, anon;
revoke all on function private.current_staff_class_ids() from public, anon;
revoke all on function private.accessible_student_ids() from public, anon;
revoke all on function private.current_staff_assignment_ids() from public, anon;
revoke all on function private.current_staff_book_ids() from public, anon;
revoke all on function private.accessible_assignment_ids() from public, anon;
revoke all on function private.submittable_assignment_ids() from public, anon;
revoke all on function private.accessible_book_ids() from public, anon;
revoke all on function private.accessible_problem_ids() from public, anon;

grant execute on function private.current_actor() to authenticated, service_role;
grant execute on function private.current_academy_ids(text[]) to authenticated, service_role;
grant execute on function private.current_student_ids() to authenticated, service_role;
grant execute on function private.current_student_academy_pairs() to authenticated, service_role;
grant execute on function private.current_student_class_ids() to authenticated, service_role;
grant execute on function private.current_assigned_class_ids() to authenticated, service_role;
grant execute on function private.current_instructor_staff_ids() to authenticated, service_role;
grant execute on function private.current_staff_class_ids() to authenticated, service_role;
grant execute on function private.accessible_student_ids() to authenticated, service_role;
grant execute on function private.current_staff_assignment_ids() to authenticated, service_role;
grant execute on function private.current_staff_book_ids() to authenticated, service_role;
grant execute on function private.accessible_assignment_ids() to authenticated, service_role;
grant execute on function private.submittable_assignment_ids() to authenticated, service_role;
grant execute on function private.accessible_book_ids() to authenticated, service_role;
grant execute on function private.accessible_problem_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Catalog-safe index reconciliation

do $$
declare
  v_column text;
  v_key_count integer;
  v_valid boolean;
begin
  if to_regclass('content.content_problems_type_idx') is not null then
    select a.attname, ix.indnkeyatts, ix.indisvalid and ix.indisready
      into v_column, v_key_count, v_valid
    from pg_index ix
    join pg_class idx on idx.oid = ix.indexrelid
    join pg_class tbl on tbl.oid = ix.indrelid
    join pg_namespace ns on ns.oid = tbl.relnamespace
    left join pg_attribute a
      on a.attrelid = tbl.oid
     and a.attnum = ix.indkey[0]
    where ns.nspname = 'content'
      and tbl.relname = 'problems'
      and idx.relname = 'content_problems_type_idx';

    if not coalesce(v_valid, false) or v_key_count <> 1 then
      raise exception 'content.content_problems_type_idx is invalid or has an unexpected key count';
    elsif v_column = 'type_id' then
      if to_regclass('content.content_problems_legacy_type_idx') is not null then
        raise exception 'Cannot preserve drifted content_problems_type_idx: content_problems_legacy_type_idx already exists';
      end if;
      alter index content.content_problems_type_idx
        rename to content_problems_legacy_type_idx;
    elsif v_column <> 'problem_type_id' then
      raise exception 'Unexpected content.content_problems_type_idx key column: %', v_column;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Compatibility wrappers with explicit privileges

create or replace function core.can_access_assigned_class(check_class_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select check_class_id in (select private.current_assigned_class_ids())
$$;

create or replace function learning.can_access_book(check_book_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select check_book_id in (select private.accessible_book_ids())
$$;

create or replace function learning.can_access_assignment(check_assignment_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select check_assignment_id in (select private.accessible_assignment_ids())
$$;

create or replace function learning.can_access_problem(check_problem_id text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select check_problem_id in (select private.accessible_problem_ids())
$$;

create or replace function learning.can_submit_assignment(check_assignment_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select check_assignment_id in (select private.submittable_assignment_ids())
$$;

create or replace function content.can_report_problem(check_problem_id text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select learning.can_access_problem(check_problem_id)
$$;

revoke all on function core.can_access_assigned_class(uuid) from public, anon;
revoke all on function learning.can_access_book(uuid) from public, anon;
revoke all on function learning.can_access_assignment(uuid) from public, anon;
revoke all on function learning.can_access_problem(text) from public, anon;
revoke all on function learning.can_submit_assignment(uuid) from public, anon;
revoke all on function content.can_report_problem(text) from public, anon;

grant execute on function core.can_access_assigned_class(uuid) to authenticated, service_role;
grant execute on function learning.can_access_book(uuid) to authenticated, service_role;
grant execute on function learning.can_access_assignment(uuid) to authenticated, service_role;
grant execute on function learning.can_access_problem(text) to authenticated, service_role;
grant execute on function learning.can_submit_assignment(uuid) to authenticated, service_role;
grant execute on function content.can_report_problem(text) to authenticated, service_role;

-- Apply least privilege to both canonical and optional legacy core helpers.
do $$
declare
  function_name text;
begin
  for function_name in
    select * from (values
      ('core.current_academy_id()'),
      ('core.current_user_account_id()'),
      ('core.current_account_id()'),
      ('core.current_person_id()'),
      ('core.current_student_id(uuid)'),
      ('core.current_staff_id(uuid)'),
      ('core.has_academy_role(uuid,text[])'),
      ('core.can_access_class(uuid)'),
      ('core.can_access_assigned_class(uuid)'),
      ('core.can_access_student(uuid)'),
      ('core.can_access_book(uuid)')
    ) as functions(identity_name)
  loop
    if to_regprocedure(function_name) is not null then
      execute format('revoke all on function %s from public, anon', function_name);
      execute format('grant execute on function %s to authenticated, service_role', function_name);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Set-based RLS policies

-- Reconcile policies that exist only in the clean local baseline. Production
-- already has the self-only user_accounts policy and the canonical
-- staff_members_access policy, so these drops are no-ops there apart from
-- recreating user_accounts_self with the same predicate.
drop policy if exists user_accounts_self_select on core.user_accounts;
drop policy if exists user_accounts_staff_select on core.user_accounts;
drop policy if exists user_accounts_self on core.user_accounts;
create policy user_accounts_self on core.user_accounts
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

drop policy if exists staff_access on core.staff_members;

drop policy if exists content_authenticated_read_books on content.books;
drop policy if exists content_authenticated_read_units on content.units;
drop policy if exists content_authenticated_read_concepts on content.concepts;
drop policy if exists content_authenticated_read_problem_types on content.problem_types;
drop policy if exists content_authenticated_read_types on content.problem_types;
drop policy if exists content_authenticated_read_problems on content.problems;
drop policy if exists content_authenticated_read_assets on content.assets;

drop policy if exists content_books_select on content.books;
drop policy if exists content_units_select on content.units;
drop policy if exists content_concepts_select on content.concepts;
drop policy if exists content_types_select on content.problem_types;
drop policy if exists content_problem_types_select on content.problem_types;
drop policy if exists content_problems_select on content.problems;
drop policy if exists content_assets_select on content.assets;

create policy content_books_select on content.books
  for select to authenticated
  using (id in (select private.accessible_book_ids()));

create policy content_units_select on content.units
  for select to authenticated
  using (book_id in (select private.accessible_book_ids()));

create policy content_concepts_select on content.concepts
  for select to authenticated
  using (book_id in (select private.accessible_book_ids()));

create policy content_problem_types_select on content.problem_types
  for select to authenticated
  using (book_id in (select private.accessible_book_ids()));

create policy content_problems_select on content.problems
  for select to authenticated
  using (id in (select private.accessible_problem_ids()));

create policy content_assets_select on content.assets
  for select to authenticated
  using (
    (
      problem_id is not null
      and kind in ('problem_image', 'question_image', 'prompt_image')
      and problem_id in (select private.accessible_problem_ids())
    )
    or (
      problem_id is null
      and book_id is not null
      and kind in ('book_cover', 'cover', 'thumbnail')
      and book_id in (select private.accessible_book_ids())
    )
  );

-- Splitting FOR ALL write policies prevents them from also becoming a second
-- permissive SELECT policy.
drop policy if exists content_staff_write_books on content.books;
drop policy if exists content_books_insert on content.books;
drop policy if exists content_books_update on content.books;
drop policy if exists content_books_delete on content.books;

create policy content_books_insert on content.books
  for insert to authenticated
  with check (
    academy_id is not null
    and academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
  );
create policy content_books_update on content.books
  for update to authenticated
  using (
    academy_id is not null
    and academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
  )
  with check (
    academy_id is not null
    and academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
  );
create policy content_books_delete on content.books
  for delete to authenticated
  using (
    academy_id is not null
    and academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
  );

drop policy if exists learning_book_assignments_select on learning.book_assignments;
create policy learning_book_assignments_select on learning.book_assignments
  for select to authenticated
  using (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (
      target_type = 'student'
      and (student_id, academy_id) in (
        select student.student_id, student.academy_id
        from private.current_student_academy_pairs() student
      )
    )
    or (target_type = 'class' and class_id in (select private.current_student_class_ids()))
    or (target_type = 'class' and class_id in (select private.current_assigned_class_ids()))
  );

drop policy if exists learning_book_assignments_insert on learning.book_assignments;
drop policy if exists learning_book_assignments_update on learning.book_assignments;
drop policy if exists learning_book_assignments_delete on learning.book_assignments;
drop policy if exists learning_book_assignments_write on learning.book_assignments;
create policy learning_book_assignments_insert on learning.book_assignments
  for insert to authenticated
  with check (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));
create policy learning_book_assignments_update on learning.book_assignments
  for update to authenticated
  using (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])))
  with check (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));
create policy learning_book_assignments_delete on learning.book_assignments
  for delete to authenticated
  using (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));

drop policy if exists learning_assignments_select on learning.assignments;
create policy learning_assignments_select on learning.assignments
  for select to authenticated
  using (id in (select private.accessible_assignment_ids()));

drop policy if exists learning_assignments_insert on learning.assignments;
drop policy if exists learning_assignments_update on learning.assignments;
drop policy if exists learning_assignments_delete on learning.assignments;
drop policy if exists learning_assignments_write on learning.assignments;
create policy learning_assignments_insert on learning.assignments
  for insert to authenticated
  with check (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));
create policy learning_assignments_update on learning.assignments
  for update to authenticated
  using (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])))
  with check (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));
create policy learning_assignments_delete on learning.assignments
  for delete to authenticated
  using (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));

drop policy if exists learning_assignment_targets_select on learning.assignment_targets;
create policy learning_assignment_targets_select on learning.assignment_targets
  for select to authenticated
  using (assignment_id in (select private.accessible_assignment_ids()));

drop policy if exists learning_assignment_targets_insert on learning.assignment_targets;
drop policy if exists learning_assignment_targets_update on learning.assignment_targets;
drop policy if exists learning_assignment_targets_delete on learning.assignment_targets;
drop policy if exists learning_assignment_targets_write on learning.assignment_targets;
create policy learning_assignment_targets_insert on learning.assignment_targets
  for insert to authenticated
  with check (assignment_id in (select private.current_staff_assignment_ids()));
create policy learning_assignment_targets_update on learning.assignment_targets
  for update to authenticated
  using (assignment_id in (select private.current_staff_assignment_ids()))
  with check (assignment_id in (select private.current_staff_assignment_ids()));
create policy learning_assignment_targets_delete on learning.assignment_targets
  for delete to authenticated
  using (assignment_id in (select private.current_staff_assignment_ids()));

drop policy if exists learning_assignment_items_select on learning.assignment_items;
create policy learning_assignment_items_select on learning.assignment_items
  for select to authenticated
  using (assignment_id in (select private.accessible_assignment_ids()));

drop policy if exists learning_assignment_items_insert on learning.assignment_items;
drop policy if exists learning_assignment_items_update on learning.assignment_items;
drop policy if exists learning_assignment_items_delete on learning.assignment_items;
drop policy if exists learning_assignment_items_write on learning.assignment_items;
create policy learning_assignment_items_insert on learning.assignment_items
  for insert to authenticated
  with check (assignment_id in (select private.current_staff_assignment_ids()));
create policy learning_assignment_items_update on learning.assignment_items
  for update to authenticated
  using (assignment_id in (select private.current_staff_assignment_ids()))
  with check (assignment_id in (select private.current_staff_assignment_ids()));
create policy learning_assignment_items_delete on learning.assignment_items
  for delete to authenticated
  using (assignment_id in (select private.current_staff_assignment_ids()));

drop policy if exists learning_assignment_files_select on learning.assignment_files;
create policy learning_assignment_files_select on learning.assignment_files
  for select to authenticated
  using (assignment_id in (select private.accessible_assignment_ids()));

drop policy if exists learning_assignment_files_insert on learning.assignment_files;
drop policy if exists learning_assignment_files_update on learning.assignment_files;
drop policy if exists learning_assignment_files_delete on learning.assignment_files;
drop policy if exists learning_assignment_files_write on learning.assignment_files;
create policy learning_assignment_files_insert on learning.assignment_files
  for insert to authenticated
  with check (assignment_id in (select private.current_staff_assignment_ids()));
create policy learning_assignment_files_update on learning.assignment_files
  for update to authenticated
  using (assignment_id in (select private.current_staff_assignment_ids()))
  with check (assignment_id in (select private.current_staff_assignment_ids()));
create policy learning_assignment_files_delete on learning.assignment_files
  for delete to authenticated
  using (assignment_id in (select private.current_staff_assignment_ids()));

drop policy if exists learning_assignment_recipients_select on learning.assignment_recipients;
create policy learning_assignment_recipients_select on learning.assignment_recipients
  for select to authenticated
  using (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (student_id, academy_id) in (
      select student.student_id, student.academy_id
      from private.current_student_academy_pairs() student
    )
    or (
      academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
      and (
        class_id in (select private.current_assigned_class_ids())
        or student_id in (select private.accessible_student_ids())
      )
    )
  );

drop policy if exists learning_assignment_recipients_write on learning.assignment_recipients;
drop policy if exists learning_assignment_recipients_insert on learning.assignment_recipients;
drop policy if exists learning_assignment_recipients_update on learning.assignment_recipients;
drop policy if exists learning_assignment_recipients_delete on learning.assignment_recipients;
create policy learning_assignment_recipients_insert on learning.assignment_recipients
  for insert to authenticated
  with check (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));
create policy learning_assignment_recipients_update on learning.assignment_recipients
  for update to authenticated
  using (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])))
  with check (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));
create policy learning_assignment_recipients_delete on learning.assignment_recipients
  for delete to authenticated
  using (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));

drop policy if exists learning_sessions_access on learning.sessions;
create policy learning_sessions_access on learning.sessions
  for select to authenticated
  using (
    core_student_id is not null
    and core_student_id in (select private.accessible_student_ids())
  );

drop policy if exists learning_sessions_insert_own on learning.sessions;
create policy learning_sessions_insert_own on learning.sessions
  for insert to authenticated
  with check (
    assignment_id is not null
    and (core_student_id, academy_id) in (
      select student.student_id, student.academy_id
      from private.current_student_academy_pairs() student
    )
    and assignment_id in (select private.submittable_assignment_ids())
  );

drop policy if exists learning_attempts_select on learning.attempts;
create policy learning_attempts_select on learning.attempts
  for select to authenticated
  using (
    core_student_id is not null
    and core_student_id in (select private.accessible_student_ids())
  );

drop policy if exists learning_attempts_insert_own on learning.attempts;
create policy learning_attempts_insert_own on learning.attempts
  for insert to authenticated
  with check (
    assignment_id is not null
    and (core_student_id, academy_id) in (
      select student.student_id, student.academy_id
      from private.current_student_academy_pairs() student
    )
    and assignment_id in (select private.submittable_assignment_ids())
    and problem_id in (select private.accessible_problem_ids())
  );

-- Preserve optional legacy auth-user ownership semantics while merging each
-- action into one authenticated policy. Fresh canonical databases do not have
-- the legacy student_id columns, so policy text is selected from the catalog.
drop policy if exists reports_own on learning.reports;
drop policy if exists learning_reports_select on learning.reports;
drop policy if exists learning_reports_insert on learning.reports;
drop policy if exists learning_reports_update on learning.reports;
drop policy if exists learning_reports_delete_legacy on learning.reports;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'learning' and table_name = 'reports' and column_name = 'student_id'
  ) then
    execute $policy$
      create policy learning_reports_select on learning.reports
      for select to authenticated
      using (
        (
          status = 'published'
          and (core_student_id, academy_id) in (
            select student.student_id, student.academy_id
            from private.current_student_academy_pairs() student
          )
        )
        or academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
        or (
          academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
          and core_student_id is not null
          and core_student_id in (select private.accessible_student_ids())
        )
        or (
          student_id = (select auth.uid())
          and academy_id in (
            select student.academy_id
            from private.current_student_academy_pairs() student
          )
        )
      )
    $policy$;
    execute $policy$
      create policy learning_reports_insert on learning.reports
      for insert to authenticated
      with check (
        academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
        or (
          student_id = (select auth.uid())
          and academy_id in (
            select student.academy_id
            from private.current_student_academy_pairs() student
          )
        )
      )
    $policy$;
    execute $policy$
      create policy learning_reports_update on learning.reports
      for update to authenticated
      using (
        academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
        or (
          student_id = (select auth.uid())
          and academy_id in (
            select student.academy_id
            from private.current_student_academy_pairs() student
          )
        )
      )
      with check (
        academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
        or (
          student_id = (select auth.uid())
          and academy_id in (
            select student.academy_id
            from private.current_student_academy_pairs() student
          )
        )
      )
    $policy$;
    execute $policy$
      create policy learning_reports_delete_legacy on learning.reports
      for delete to authenticated
      using (
        student_id = (select auth.uid())
        and academy_id in (
          select student.academy_id
          from private.current_student_academy_pairs() student
        )
      )
    $policy$;
  else
    create policy learning_reports_select on learning.reports
      for select to authenticated
      using (
        (
          status = 'published'
          and (core_student_id, academy_id) in (
            select student.student_id, student.academy_id
            from private.current_student_academy_pairs() student
          )
        )
        or academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
        or (
          academy_id in (select private.current_academy_ids(array['teacher', 'instructor']))
          and core_student_id is not null
          and core_student_id in (select private.accessible_student_ids())
        )
      );
    create policy learning_reports_insert on learning.reports
      for insert to authenticated
      with check (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));
    create policy learning_reports_update on learning.reports
      for update to authenticated
      using (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])))
      with check (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));
  end if;
end;
$$;

-- Consolidate the remaining FOR ALL + SELECT pairs without changing their
-- effective staff access semantics.
drop policy if exists classes_staff_write on core.classes;
drop policy if exists classes_staff_insert on core.classes;
drop policy if exists classes_staff_update on core.classes;
drop policy if exists classes_staff_delete on core.classes;
create policy classes_staff_insert on core.classes
  for insert to authenticated
  with check (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));
create policy classes_staff_update on core.classes
  for update to authenticated
  using (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])))
  with check (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));
create policy classes_staff_delete on core.classes
  for delete to authenticated
  using (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));

drop policy if exists class_students_staff_write on core.class_students;
drop policy if exists class_students_staff_insert on core.class_students;
drop policy if exists class_students_staff_update on core.class_students;
drop policy if exists class_students_staff_delete on core.class_students;
create policy class_students_staff_insert on core.class_students
  for insert to authenticated
  with check (class_id in (select private.current_staff_class_ids()));
create policy class_students_staff_update on core.class_students
  for update to authenticated
  using (class_id in (select private.current_staff_class_ids()))
  with check (class_id in (select private.current_staff_class_ids()));
create policy class_students_staff_delete on core.class_students
  for delete to authenticated
  using (class_id in (select private.current_staff_class_ids()));

drop policy if exists class_books_staff_write on core.class_books;
drop policy if exists class_books_staff_insert on core.class_books;
drop policy if exists class_books_staff_update on core.class_books;
drop policy if exists class_books_staff_delete on core.class_books;
create policy class_books_staff_insert on core.class_books
  for insert to authenticated
  with check (class_id in (select private.current_staff_class_ids()));
create policy class_books_staff_update on core.class_books
  for update to authenticated
  using (class_id in (select private.current_staff_class_ids()))
  with check (class_id in (select private.current_staff_class_ids()));
create policy class_books_staff_delete on core.class_books
  for delete to authenticated
  using (class_id in (select private.current_staff_class_ids()));

drop policy if exists lms_courses_write on lms.courses;
drop policy if exists lms_courses_insert on lms.courses;
drop policy if exists lms_courses_update on lms.courses;
drop policy if exists lms_courses_delete on lms.courses;
create policy lms_courses_insert on lms.courses
  for insert to authenticated
  with check (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));
create policy lms_courses_update on lms.courses
  for update to authenticated
  using (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])))
  with check (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));
create policy lms_courses_delete on lms.courses
  for delete to authenticated
  using (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));

drop policy if exists lms_classrooms_write on lms.classrooms;
drop policy if exists lms_classrooms_insert on lms.classrooms;
drop policy if exists lms_classrooms_update on lms.classrooms;
drop policy if exists lms_classrooms_delete on lms.classrooms;
create policy lms_classrooms_insert on lms.classrooms
  for insert to authenticated
  with check (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));
create policy lms_classrooms_update on lms.classrooms
  for update to authenticated
  using (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])))
  with check (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));
create policy lms_classrooms_delete on lms.classrooms
  for delete to authenticated
  using (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));

drop policy if exists lms_class_profiles_write on lms.class_profiles;
drop policy if exists lms_class_profiles_insert on lms.class_profiles;
drop policy if exists lms_class_profiles_update on lms.class_profiles;
drop policy if exists lms_class_profiles_delete on lms.class_profiles;
create policy lms_class_profiles_insert on lms.class_profiles
  for insert to authenticated
  with check (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));
create policy lms_class_profiles_update on lms.class_profiles
  for update to authenticated
  using (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])))
  with check (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));
create policy lms_class_profiles_delete on lms.class_profiles
  for delete to authenticated
  using (academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff'])));

-- Historical occurrences grant access only to that occurrence and its
-- attendance, never durable access to the whole class roster.
drop policy if exists lms_occurrences_select on lms.lesson_occurrences;
create policy lms_occurrences_select on lms.lesson_occurrences
  for select to authenticated
  using (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or class_id in (select private.current_assigned_class_ids())
    or instructor_staff_id in (select private.current_instructor_staff_ids())
    or substitute_staff_id in (select private.current_instructor_staff_ids())
  );

drop policy if exists lms_attendance_select on lms.attendance_records;
create policy lms_attendance_select on lms.attendance_records
  for select to authenticated
  using (
    academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
    or (student_id, academy_id) in (
      select student.student_id, student.academy_id
      from private.current_student_academy_pairs() student
    )
    or exists (
      select 1
      from lms.lesson_occurrences occurrence
      where occurrence.id = attendance_records.occurrence_id
        and (
          occurrence.class_id in (select private.current_assigned_class_ids())
          or occurrence.instructor_staff_id in (select private.current_instructor_staff_ids())
          or occurrence.substitute_staff_id in (select private.current_instructor_staff_ids())
        )
    )
  );

drop policy if exists wrong_notes_own on learning.wrong_notes;
drop policy if exists learning_wrong_notes_select on learning.wrong_notes;
drop policy if exists learning_wrong_notes_insert on learning.wrong_notes;
drop policy if exists learning_wrong_notes_update on learning.wrong_notes;
drop policy if exists learning_wrong_notes_delete on learning.wrong_notes;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'learning' and table_name = 'wrong_notes' and column_name = 'student_id'
  ) then
    execute $policy$
      create policy learning_wrong_notes_select on learning.wrong_notes
      for select to authenticated
      using (
        (core_student_id is not null and core_student_id in (select private.accessible_student_ids()))
        or (
          student_id = (select auth.uid())
          and academy_id in (
            select student.academy_id
            from private.current_student_academy_pairs() student
          )
        )
      )
    $policy$;
    execute $policy$
      create policy learning_wrong_notes_insert on learning.wrong_notes
      for insert to authenticated
      with check (
        (core_student_id, academy_id) in (
          select student.student_id, student.academy_id
          from private.current_student_academy_pairs() student
        )
        or academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
        or (
          student_id = (select auth.uid())
          and academy_id in (
            select student.academy_id
            from private.current_student_academy_pairs() student
          )
        )
      )
    $policy$;
    execute $policy$
      create policy learning_wrong_notes_update on learning.wrong_notes
      for update to authenticated
      using (
        (core_student_id, academy_id) in (
          select student.student_id, student.academy_id
          from private.current_student_academy_pairs() student
        )
        or academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
        or (
          student_id = (select auth.uid())
          and academy_id in (
            select student.academy_id
            from private.current_student_academy_pairs() student
          )
        )
      )
      with check (
        (core_student_id, academy_id) in (
          select student.student_id, student.academy_id
          from private.current_student_academy_pairs() student
        )
        or academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
        or (
          student_id = (select auth.uid())
          and academy_id in (
            select student.academy_id
            from private.current_student_academy_pairs() student
          )
        )
      )
    $policy$;
    execute $policy$
      create policy learning_wrong_notes_delete on learning.wrong_notes
      for delete to authenticated
      using (
        (core_student_id, academy_id) in (
          select student.student_id, student.academy_id
          from private.current_student_academy_pairs() student
        )
        or academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
        or (
          student_id = (select auth.uid())
          and academy_id in (
            select student.academy_id
            from private.current_student_academy_pairs() student
          )
        )
      )
    $policy$;
  else
    create policy learning_wrong_notes_select on learning.wrong_notes
      for select to authenticated
      using (core_student_id is not null and core_student_id in (select private.accessible_student_ids()));
    create policy learning_wrong_notes_insert on learning.wrong_notes
      for insert to authenticated
      with check (
        (core_student_id, academy_id) in (
          select student.student_id, student.academy_id
          from private.current_student_academy_pairs() student
        )
        or academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
      );
    create policy learning_wrong_notes_update on learning.wrong_notes
      for update to authenticated
      using (
        (core_student_id, academy_id) in (
          select student.student_id, student.academy_id
          from private.current_student_academy_pairs() student
        )
        or academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
      )
      with check (
        (core_student_id, academy_id) in (
          select student.student_id, student.academy_id
          from private.current_student_academy_pairs() student
        )
        or academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
      );
    create policy learning_wrong_notes_delete on learning.wrong_notes
      for delete to authenticated
      using (
        (core_student_id, academy_id) in (
          select student.student_id, student.academy_id
          from private.current_student_academy_pairs() student
        )
        or academy_id in (select private.current_academy_ids(array['owner', 'admin', 'staff']))
      );
  end if;
end;
$$;

-- Fix the remaining auth RLS init-plan findings on optional legacy tables.
do $$
begin
  if to_regclass('core.profiles') is not null then
    if exists (
      select 1 from pg_policy
      where polrelid = to_regclass('core.profiles') and polname = 'profiles_self'
    ) then
      execute 'alter policy profiles_self on core.profiles using (id = (select auth.uid()))';
    end if;
  end if;

  if to_regclass('learning.books') is not null then
    if exists (
      select 1 from pg_policy
      where polrelid = to_regclass('learning.books') and polname = 'books_assigned'
    ) then
      execute $policy$
        alter policy books_assigned on learning.books
        using (
          exists (
            select 1
            from core.class_books cb
            join core.class_students cs on cs.class_id = cb.class_id
            join core.classes c on c.id = cs.class_id
            where cb.book_id = books.id
            and (
              (cs.student_id, c.academy_id) in (
                select student.student_id, student.academy_id
                from private.current_student_academy_pairs() student
              )
              or cs.student_id = (select auth.uid())
            )
            and cs.status = 'active'
            and c.active
          )
        )
      $policy$;
    end if;
  end if;
end;
$$;

-- Reassert answer secrecy after the policy rewrite. Service-role grants remain
-- untouched for trusted server-side grading.
revoke select on content.problems from public, anon, authenticated;
grant select (
  id,
  book_id,
  unit_id,
  concept_id,
  problem_type_id,
  type_id,
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
revoke select on content.student_problems from public, anon;
grant select on content.student_problems to authenticated;

create index if not exists content_problems_type_idx
  on content.problems (problem_type_id)
  where problem_type_id is not null;

-- Cursor and scoped aggregate indexes. Equality keys precede range/order keys.
create index if not exists content_problems_book_page_cursor_idx
  on content.problems (book_id, page_printed, id);
create index if not exists content_problems_book_unit_page_cursor_idx
  on content.problems (book_id, unit_id, page_printed, id);
create index if not exists content_problems_book_type_page_cursor_idx
  on content.problems (book_id, problem_type_id, page_printed, id);
create index if not exists learning_assignments_academy_created_cursor_idx
  on learning.assignments (academy_id, created_at desc, id desc);
create index if not exists learning_attempts_assignment_created_idx
  on learning.attempts (assignment_id, created_at desc)
  where assignment_id is not null;
create index if not exists learning_sessions_assignment_student_submitted_idx
  on learning.sessions (assignment_id, core_student_id, submitted_at)
  where assignment_id is not null;
create index if not exists learning_attempts_student_created_cursor_idx
  on learning.attempts (academy_id, core_student_id, created_at desc, id desc);
create index if not exists core_students_academy_created_cursor_idx
  on core.students (academy_id, created_at desc, id desc);
create index if not exists core_staff_academy_created_cursor_idx
  on core.staff_members (academy_id, created_at desc, id desc);

-- Workload-critical FK indexes. Lower-value/empty-table advisor findings remain
-- documented monitoring candidates rather than adding write amplification now.
create index if not exists content_books_academy_fk_idx
  on content.books (academy_id);
create index if not exists content_concepts_unit_fk_idx
  on content.concepts (unit_id);
create index if not exists content_problem_types_unit_fk_idx
  on content.problem_types (unit_id);
create index if not exists learning_assignment_recipients_student_fk_idx
  on learning.assignment_recipients (student_id);
create index if not exists learning_assignment_recipients_class_fk_idx
  on learning.assignment_recipients (class_id);
create index if not exists learning_attempts_problem_fk_idx
  on learning.attempts (problem_id);
create index if not exists learning_sessions_academy_fk_idx
  on learning.sessions (academy_id);

-- Remove only the six catalog-confirmed exact duplicate indexes. If a named
-- pair ever drifts, abort rather than dropping a potentially useful index.
do $$
declare
  pair record;
  keep_oid regclass;
  drop_oid regclass;
  is_exact boolean;
begin
  for pair in
    select *
    from (values
      ('core.core_members_person_idx', 'core.core_academy_members_person_idx'),
      ('core.core_members_account_idx', 'core.core_academy_members_account_idx'),
      ('core.core_people_academy_idx', 'core.core_people_primary_academy_idx'),
      ('learning.learning_attempts_session_idx', 'learning.attempts_session'),
      ('learning.learning_reports_student_idx', 'learning.learning_reports_academy_student_generated_idx'),
      ('learning.learning_sessions_student_idx', 'learning.learning_sessions_core_student_idx')
    ) as pairs(keep_name, drop_name)
  loop
    keep_oid := to_regclass(pair.keep_name);
    drop_oid := to_regclass(pair.drop_name);

    if keep_oid is not null and drop_oid is not null then
      select
        keep_idx.indrelid = drop_idx.indrelid
        and keep_idx.indisunique = drop_idx.indisunique
        and keep_idx.indisprimary = drop_idx.indisprimary
        and keep_idx.indisexclusion = drop_idx.indisexclusion
        and keep_idx.indnkeyatts = drop_idx.indnkeyatts
        and keep_idx.indnatts = drop_idx.indnatts
        and keep_idx.indkey = drop_idx.indkey
        and keep_idx.indcollation = drop_idx.indcollation
        and keep_idx.indclass = drop_idx.indclass
        and keep_idx.indoption = drop_idx.indoption
        and coalesce(keep_idx.indexprs::text, '') = coalesce(drop_idx.indexprs::text, '')
        and coalesce(keep_idx.indpred::text, '') = coalesce(drop_idx.indpred::text, '')
      into is_exact
      from pg_index keep_idx
      cross join pg_index drop_idx
      where keep_idx.indexrelid = keep_oid
        and drop_idx.indexrelid = drop_oid;

      if not coalesce(is_exact, false) then
        raise exception 'Refusing to drop non-identical index pair: % and %', pair.keep_name, pair.drop_name;
      end if;

      execute format('drop index %s', drop_oid);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime v2 contract

create or replace function private.emit_lms_invalidation_v2(
  p_academy_id uuid,
  p_domains text[],
  p_entity_type text default null,
  p_entity_ids text[] default null,
  p_core_student_id uuid default null,
  p_event_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid := coalesce(p_event_id, gen_random_uuid());
  v_claims jsonb := '{}'::jsonb;
  v_role text;
begin
  begin
    v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  exception when invalid_text_representation then
    v_claims := '{}'::jsonb;
  end;

  v_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    v_claims->>'role',
    ''
  );

  if (select auth.uid()) is null and v_role <> 'service_role' then
    raise exception using errcode = '42501', message = 'Authentication is required to emit LMS invalidation events.';
  end if;

  if v_role <> 'service_role'
     and p_academy_id not in (
       select private.current_academy_ids(
         array['owner', 'admin', 'staff', 'teacher', 'instructor', 'student', 'guardian']
       )
     ) then
    raise exception using errcode = '42501', message = 'Caller is not a member of the requested academy.';
  end if;

  if p_academy_id is null then
    raise exception using errcode = '22023', message = 'academy_id is required.';
  end if;
  if coalesce(cardinality(p_domains), 0) = 0
     or cardinality(p_domains) > 10
     or exists (
       select 1
       from unnest(p_domains) domain_name
       where domain_name is null
          or domain_name not in ('students', 'staff', 'classes', 'accounting', 'assignments', 'learning', 'reports', 'ai', 'data', 'lms')
     )
     or cardinality(p_domains) <> (
       select count(distinct domain_name)
       from unnest(p_domains) domain_name
     ) then
    raise exception using errcode = '22023', message = 'A unique, non-null set of supported LMS invalidation domains is required.';
  end if;
  if p_entity_type is not null
     and p_entity_type !~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' then
    raise exception using errcode = '22023', message = 'entityType must be a schema-qualified lowercase identifier.';
  end if;
  if p_entity_ids is not null and (
       cardinality(p_entity_ids) > 100
       or exists (
         select 1 from unnest(p_entity_ids) entity_id
         where entity_id is null or btrim(entity_id) = ''
       )
       or cardinality(p_entity_ids) <> (
         select count(distinct entity_id)
         from unnest(p_entity_ids) entity_id
       )
     ) then
    raise exception using errcode = '22023', message = 'entityIds must contain at most 100 unique, non-blank values.';
  end if;
  if p_core_student_id is not null and not exists (
    select 1
    from core.students student
    where student.id = p_core_student_id
      and student.academy_id = p_academy_id
  ) then
    raise exception using errcode = '22023', message = 'coreStudentId must belong to the event academy.';
  end if;

  perform realtime.send(
    jsonb_strip_nulls(jsonb_build_object(
      'version', 2,
      'eventId', v_event_id,
      'academyId', p_academy_id,
      'domains', to_jsonb(p_domains),
      'entityType', p_entity_type,
      'entityIds', to_jsonb(p_entity_ids),
      'coreStudentId', p_core_student_id,
      'occurredAt', clock_timestamp()
    )),
    'lms-cache-invalidated-v2',
    'academy:' || p_academy_id::text || ':lms-cache',
    true
  );

  return v_event_id;
end;
$$;

comment on function private.emit_lms_invalidation_v2(uuid, text[], text, text[], uuid, uuid) is
  'Emits one canonical v2 cache event for a logical mutation. v1 row-trigger events remain enabled during migration.';

revoke all on function private.emit_lms_invalidation_v2(uuid, text[], text, text[], uuid, uuid)
  from public, anon;
grant execute on function private.emit_lms_invalidation_v2(uuid, text[], text, text[], uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Bounded read APIs

create or replace function learning.list_problem_catalog_v2(
  p_book_id uuid,
  p_unit_id uuid default null,
  p_problem_type_id uuid default null,
  p_is_example boolean default null,
  p_after_page_printed integer default null,
  p_after_id text default null,
  p_limit integer default 50
)
returns table (
  problem_id text,
  book_id uuid,
  unit_id uuid,
  concept_id uuid,
  problem_type_id uuid,
  page_printed integer,
  problem_number text,
  image_path text,
  public_payload jsonb,
  position_in_type integer,
  is_example boolean,
  difficulty_hint text,
  verified boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (p_after_page_printed is null) <> (p_after_id is null) then
    raise exception using errcode = '22023', message = 'Both problem cursor fields must be supplied together.';
  end if;

  return query
  select
    p.id,
    p.book_id,
    p.unit_id,
    p.concept_id,
    p.problem_type_id,
    p.page_printed,
    p.number,
    p.image_path,
    p.public_payload,
    p.position_in_type,
    p.is_example,
    p.difficulty_hint,
    p.verified,
    p.created_at,
    p.updated_at
  from content.student_problems p
  where p.book_id = p_book_id
    and p.page_printed is not null
    and (p_unit_id is null or p.unit_id = p_unit_id)
    and (p_problem_type_id is null or p.problem_type_id = p_problem_type_id)
    and (p_is_example is null or p.is_example = p_is_example)
    and (
      p_after_page_printed is null
      or (p.page_printed, p.id) > (p_after_page_printed, p_after_id)
    )
  order by p.page_printed, p.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

comment on function learning.list_problem_catalog_v2(uuid, uuid, uuid, boolean, integer, text, integer) is
  'Answer-safe (page_printed, id) keyset problem catalog. Page size is clamped to 1..100.';

create or replace function learning.assignment_overview_v2(
  p_academy_id uuid,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns table (
  assignment_id uuid,
  book_id uuid,
  title text,
  description text,
  context text,
  status text,
  active boolean,
  available_from timestamptz,
  due_at timestamptz,
  created_at timestamptz,
  item_count bigint,
  recipient_count bigint,
  submitted_recipient_count bigint,
  attempt_count bigint,
  last_activity_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (p_after_created_at is null) <> (p_after_id is null) then
    raise exception using errcode = '22023', message = 'Both assignment cursor fields must be supplied together.';
  end if;

  return query
  with page as materialized (
    select a.*
    from learning.assignments a
    where a.academy_id = p_academy_id
      and (
        current_user = 'service_role'
        or p_academy_id in (
          select private.current_academy_ids(array['owner', 'admin', 'staff', 'teacher', 'instructor'])
        )
      )
      and (
        p_after_created_at is null
        or a.created_at < p_after_created_at
        or (
          a.created_at = p_after_created_at
          and (p_after_id is null or a.id < p_after_id)
        )
      )
    order by a.created_at desc, a.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ),
  item_stats as (
    select i.assignment_id, count(*)::bigint as item_count
    from learning.assignment_items i
    join page p on p.id = i.assignment_id
    group by i.assignment_id
  ),
  recipient_stats as (
    select r.assignment_id, count(*) filter (where r.active)::bigint as recipient_count
    from learning.assignment_recipients r
    join page p on p.id = r.assignment_id
    group by r.assignment_id
  ),
  session_stats as (
    select
      s.assignment_id,
      count(distinct s.core_student_id) filter (where s.submitted_at is not null)::bigint as submitted_count,
      max(coalesce(s.submitted_at, s.started_at)) as last_session_at
    from learning.sessions s
    join page p on p.id = s.assignment_id
    group by s.assignment_id
  ),
  attempt_stats as (
    select a.assignment_id, count(*)::bigint as attempt_count, max(a.created_at) as last_attempt_at
    from learning.attempts a
    join page p on p.id = a.assignment_id
    group by a.assignment_id
  )
  select
    p.id,
    p.book_id,
    p.title,
    p.description,
    p.context,
    p.status,
    p.active,
    p.available_from,
    p.due_at,
    p.created_at,
    coalesce(i.item_count, 0),
    coalesce(r.recipient_count, 0),
    coalesce(s.submitted_count, 0),
    coalesce(attempts.attempt_count, 0),
    greatest(s.last_session_at, attempts.last_attempt_at)
  from page p
  left join item_stats i on i.assignment_id = p.id
  left join recipient_stats r on r.assignment_id = p.id
  left join session_stats s on s.assignment_id = p.id
  left join attempt_stats attempts on attempts.assignment_id = p.id
  order by p.created_at desc, p.id desc;
end;
$$;

comment on function learning.assignment_overview_v2(uuid, timestamptz, uuid, integer) is
  'Keyset-paginated assignment overview with aggregates scoped to at most 100 assignments.';

create or replace function learning.student_progress_summary_v2(
  p_academy_id uuid,
  p_student_id uuid,
  p_from timestamptz default (now() - interval '30 days'),
  p_to timestamptz default now()
)
returns table (
  attempt_count bigint,
  correct_count bigint,
  unsure_count bigint,
  distinct_problem_count bigint,
  average_duration_ms numeric,
  first_attempt_at timestamptz,
  last_attempt_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      greatest(
        coalesce(p_from, now() - interval '30 days'),
        coalesce(p_to, now()) - interval '366 days'
      ) as starts_at,
      coalesce(p_to, now()) as ends_at
  )
  select
    count(*)::bigint,
    count(*) filter (where a.correct)::bigint,
    count(*) filter (where a.unsure)::bigint,
    count(distinct a.problem_id)::bigint,
    avg(a.duration_ms)::numeric,
    min(a.created_at),
    max(a.created_at)
  from learning.attempts a
  cross join bounds b
  where a.academy_id = p_academy_id
    and a.core_student_id = p_student_id
    and exists (
      select 1
      from core.students student
      where student.id = p_student_id
        and student.academy_id = p_academy_id
    )
    and a.created_at >= b.starts_at
    and a.created_at < b.ends_at
    and (
      current_user = 'service_role'
      or p_student_id in (select private.accessible_student_ids())
    )
$$;

comment on function learning.student_progress_summary_v2(uuid, uuid, timestamptz, timestamptz) is
  'Period aggregate clamped to a maximum 366-day scan window.';

create or replace function learning.list_student_attempts_v2(
  p_academy_id uuid,
  p_student_id uuid,
  p_from timestamptz default (now() - interval '30 days'),
  p_to timestamptz default now(),
  p_after_created_at timestamptz default null,
  p_after_id bigint default null,
  p_limit integer default 50
)
returns table (
  attempt_id bigint,
  session_id uuid,
  assignment_id uuid,
  problem_id text,
  correct boolean,
  unsure boolean,
  attempt_no integer,
  duration_ms integer,
  created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (p_after_created_at is null) <> (p_after_id is null) then
    raise exception using errcode = '22023', message = 'Both attempt cursor fields must be supplied together.';
  end if;

  return query
  with bounds as (
    select
      greatest(
        coalesce(p_from, now() - interval '30 days'),
        coalesce(p_to, now()) - interval '366 days'
      ) as starts_at,
      coalesce(p_to, now()) as ends_at
  )
  select
    a.id,
    a.session_id,
    a.assignment_id,
    a.problem_id,
    a.correct,
    a.unsure,
    a.attempt_no,
    a.duration_ms,
    a.created_at
  from learning.attempts a
  cross join bounds b
  where a.academy_id = p_academy_id
    and a.core_student_id = p_student_id
    and exists (
      select 1
      from core.students student
      where student.id = p_student_id
        and student.academy_id = p_academy_id
    )
    and a.created_at >= b.starts_at
    and a.created_at < b.ends_at
    and (
      current_user = 'service_role'
      or p_student_id in (select private.accessible_student_ids())
    )
    and (
      p_after_created_at is null
      or a.created_at < p_after_created_at
      or (
        a.created_at = p_after_created_at
        and (p_after_id is null or a.id < p_after_id)
      )
    )
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

comment on function learning.list_student_attempts_v2(uuid, uuid, timestamptz, timestamptz, timestamptz, bigint, integer) is
  'Keyset-paginated attempt feed with a maximum 366-day window and 100 rows.';

revoke all on function learning.list_problem_catalog_v2(uuid, uuid, uuid, boolean, integer, text, integer) from public, anon;
revoke all on function learning.assignment_overview_v2(uuid, timestamptz, uuid, integer) from public, anon;
revoke all on function learning.student_progress_summary_v2(uuid, uuid, timestamptz, timestamptz) from public, anon;
revoke all on function learning.list_student_attempts_v2(uuid, uuid, timestamptz, timestamptz, timestamptz, bigint, integer) from public, anon;

grant execute on function learning.list_problem_catalog_v2(uuid, uuid, uuid, boolean, integer, text, integer) to authenticated, service_role;
grant execute on function learning.assignment_overview_v2(uuid, timestamptz, uuid, integer) to authenticated, service_role;
grant execute on function learning.student_progress_summary_v2(uuid, uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function learning.list_student_attempts_v2(uuid, uuid, timestamptz, timestamptz, timestamptz, bigint, integer) to authenticated, service_role;

create or replace function lms.list_staff_roster_v2(
  p_academy_id uuid,
  p_query text default null,
  p_include_sensitive boolean default false,
  p_peer_only boolean default false,
  p_matching_roles text[] default null,
  p_role text default 'all',
  p_status text default 'operations',
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_visible_staff_ids uuid[] default null,
  p_search_class_ids uuid[] default null,
  p_limit integer default 50
)
returns table (
  staff_id uuid,
  created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_limit integer := coalesce(p_limit, 50);
  v_is_operations_user boolean := false;
  v_is_assigned_user boolean := false;
begin
  if p_academy_id is null then
    raise exception using errcode = '22023', message = 'academy_id is required.';
  end if;
  if length(v_query) > 80 then
    raise exception using errcode = '22023', message = 'query must contain at most 80 characters.';
  end if;
  if p_role is null or p_role not in ('all', 'admin', 'staff', 'teacher', 'instructor') then
    raise exception using errcode = '22023', message = 'Unsupported staff role filter.';
  end if;
  if p_status is null or p_status not in ('operations', 'all', 'active', 'inactive', 'on_leave') then
    raise exception using errcode = '22023', message = 'Unsupported staff status filter.';
  end if;
  if v_limit < 1 or v_limit > 100 then
    raise exception using errcode = '22023', message = 'limit must be between 1 and 100.';
  end if;
  if (p_after_created_at is null) <> (p_after_id is null) then
    raise exception using errcode = '22023', message = 'Both cursor fields must be supplied together.';
  end if;
  if coalesce(cardinality(p_matching_roles), 0) > 4
     or exists (
       select 1
       from unnest(coalesce(p_matching_roles, array[]::text[])) role_name
       where role_name is null
          or role_name not in ('admin', 'staff', 'teacher', 'instructor')
     )
     or cardinality(coalesce(p_matching_roles, array[]::text[])) <> (
       select count(distinct role_name)
       from unnest(coalesce(p_matching_roles, array[]::text[])) role_name
     ) then
    raise exception using errcode = '22023', message = 'matching_roles must contain unique supported staff roles.';
  end if;
  if coalesce(cardinality(p_visible_staff_ids), 0) > 2000
     or exists (
       select 1
       from unnest(coalesce(p_visible_staff_ids, array[]::uuid[])) visible_id(value)
       where visible_id.value is null
     ) then
    raise exception using errcode = '22023', message = 'visible_staff_ids must contain at most 2000 non-null IDs.';
  end if;
  if coalesce(cardinality(p_search_class_ids), 0) > 1000
     or exists (
       select 1
       from unnest(coalesce(p_search_class_ids, array[]::uuid[])) class_id
       where class_id is null
     ) then
    raise exception using errcode = '22023', message = 'search_class_ids must contain at most 1000 non-null IDs.';
  end if;

  if current_user <> 'service_role' then
    v_is_operations_user := p_academy_id in (
      select private.current_academy_ids(array['owner', 'admin', 'staff'])
    );
    v_is_assigned_user := p_academy_id in (
      select private.current_academy_ids(array['teacher', 'instructor'])
    );

    if not v_is_operations_user and not v_is_assigned_user then
      raise exception using errcode = '42501', message = 'Caller cannot read this staff roster.';
    end if;
    if v_is_assigned_user and not v_is_operations_user then
      if coalesce(p_include_sensitive, false) then
        raise exception using errcode = '42501', message = 'Assigned staff cannot search sensitive contact fields.';
      end if;
      if p_visible_staff_ids is null or p_search_class_ids is null then
        raise exception using errcode = '42501', message = 'Assigned staff calls require explicit peer and class scopes.';
      end if;
      if not coalesce(p_peer_only, false) then
        raise exception using errcode = '42501', message = 'Assigned staff calls require the peer-only role scope.';
      end if;
    end if;
  end if;

  return query
  select staff.id, staff.created_at
  from core.staff_members staff
  join core.people person on person.id = staff.person_id
  where staff.academy_id = p_academy_id
    and staff.role in ('admin', 'staff', 'teacher', 'instructor')
    and (not coalesce(p_peer_only, false) or staff.role in ('teacher', 'instructor'))
    and (p_visible_staff_ids is null or staff.id = any(p_visible_staff_ids))
    and (p_role = 'all' or staff.role = p_role)
    and (
      p_status = 'all'
      or (p_status = 'operations' and staff.status in ('active', 'on_leave'))
      or (p_status not in ('all', 'operations') and staff.status = p_status)
    )
    and (
      p_after_created_at is null
      or staff.created_at < p_after_created_at
      or (staff.created_at = p_after_created_at and staff.id < p_after_id)
    )
    and (
      v_query = ''
      or position(v_query in lower(coalesce(person.display_name, ''))) > 0
      or position(v_query in lower(coalesce(person.full_name, ''))) > 0
      or (
        coalesce(p_include_sensitive, false)
        and (
          position(v_query in lower(coalesce(person.phone, ''))) > 0
          or position(v_query in lower(coalesce(person.email, ''))) > 0
        )
      )
      or staff.role = any(coalesce(p_matching_roles, array[]::text[]))
      or exists (
        select 1
        from lms.class_profiles profile
        join core.classes class_row on class_row.id = profile.class_id
        where profile.default_instructor_staff_id = staff.id
          and class_row.academy_id = p_academy_id
          and (p_search_class_ids is null or class_row.id = any(p_search_class_ids))
          and position(v_query in lower(coalesce(class_row.name, ''))) > 0
      )
    )
  order by staff.created_at desc, staff.id desc
  limit v_limit + 1;
end;
$$;

comment on function lms.list_staff_roster_v2(uuid, text, boolean, boolean, text[], text, text, timestamptz, uuid, uuid[], uuid[], integer) is
  'Bounded staff search across people, role labels, and assigned class names; returns limit+1 keyset rows for client pagination.';

revoke all on function lms.list_staff_roster_v2(uuid, text, boolean, boolean, text[], text, text, timestamptz, uuid, uuid[], uuid[], integer)
  from public, anon;
grant execute on function lms.list_staff_roster_v2(uuid, text, boolean, boolean, text[], text, text, timestamptz, uuid, uuid[], uuid[], integer)
  to authenticated, service_role;

create or replace function lms.class_operations_read_v2(
  p_academy_id uuid,
  p_view text default 'overview',
  p_start_date date default current_date,
  p_end_date date default (current_date + 14),
  p_class_ids uuid[] default null,
  p_class_limit integer default 100
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_academy_id is null then
    raise exception using errcode = '22023', message = 'academy_id is required.';
  end if;
  if p_view is null or p_view not in ('overview', 'schedule', 'attendance', 'settings') then
    raise exception using errcode = '22023', message = 'view must be overview, schedule, attendance, or settings.';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception using errcode = '22023', message = 'A valid inclusive date window is required.';
  end if;
  if p_end_date - p_start_date > 92 then
    raise exception using errcode = '22023', message = 'Class operations date windows are limited to 93 days.';
  end if;
  if coalesce(cardinality(p_class_ids), 0) > 1000 then
    raise exception using errcode = '22023', message = 'At most 1000 class filter IDs may be requested.';
  end if;
  if exists (select 1 from unnest(coalesce(p_class_ids, array[]::uuid[])) class_id where class_id is null) then
    raise exception using errcode = '22023', message = 'class filter IDs cannot contain nulls.';
  end if;
  if current_user <> 'service_role'
     and (
       (
         p_view = 'settings'
         and p_academy_id not in (
           select private.current_academy_ids(array['owner', 'admin', 'staff'])
         )
       )
       or (
         p_view <> 'settings'
         and p_academy_id not in (
           select private.current_academy_ids(array['owner', 'admin', 'staff', 'teacher', 'instructor'])
         )
       )
     ) then
    raise exception using errcode = '42501', message = 'Caller cannot read class operations for this academy.';
  end if;

  with class_candidates as materialized (
    select c.id, c.name, c.grade, c.active
    from core.classes c
    where c.academy_id = p_academy_id
      and (p_class_ids is null or c.id = any(p_class_ids))
    order by c.name, c.id
    limit least(greatest(coalesce(p_class_limit, 100), 1), 100) + 1
  ),
  selected_classes as materialized (
    select candidate.*
    from class_candidates candidate
    order by candidate.name, candidate.id
    limit least(greatest(coalesce(p_class_limit, 100), 1), 100)
  ),
  class_summaries as materialized (
    select
      c.id,
      c.name,
      c.grade,
      c.active,
      coalesce(cp.status, case when c.active then 'active' else 'inactive' end) as status,
      cp.color,
      cp.capacity,
      cp.default_instructor_staff_id,
      cp.default_classroom_id,
      course.title as course_title,
      coalesce(person.display_name, person.full_name) as instructor_name,
      classroom.name as classroom_name,
      coalesce(enrollment.student_count, 0) as student_count,
      coalesce(learning.weak_type_count, 0) as weak_type_count,
      learning.avg_type_score,
      learning.last_learning_at
    from selected_classes c
    left join lms.class_profiles cp
      on cp.class_id = c.id
     and cp.academy_id = p_academy_id
    left join lms.courses course on course.id = cp.course_id
    left join lms.classrooms classroom on classroom.id = cp.default_classroom_id
    left join core.staff_members staff on staff.id = cp.default_instructor_staff_id
    left join core.people person on person.id = staff.person_id
    left join reporting.v_class_learning_summary learning
      on learning.class_id = c.id
     and learning.academy_id = p_academy_id
    left join lateral (
      select count(*)::integer as student_count
      from core.class_students cs
      where cs.class_id = c.id and cs.status = 'active'
    ) enrollment on true
  ),
  schedule_rules as materialized (
    select
      rule.id,
      rule.class_id,
      c.name as class_name,
      rule.day_of_week,
      rule.start_time,
      rule.end_time,
      rule.start_date,
      rule.end_date,
      rule.active,
      coalesce(rule.classroom_id, cp.default_classroom_id) as classroom_id,
      classroom.name as classroom_name,
      coalesce(rule.instructor_staff_id, cp.default_instructor_staff_id) as instructor_id,
      coalesce(person.display_name, person.full_name) as instructor_name,
      rule.interval_weeks
    from lms.class_schedule_rules rule
    join selected_classes c on c.id = rule.class_id
    left join lms.class_profiles cp on cp.class_id = rule.class_id
    left join lms.classrooms classroom
      on classroom.id = coalesce(rule.classroom_id, cp.default_classroom_id)
    left join core.staff_members staff
      on staff.id = coalesce(rule.instructor_staff_id, cp.default_instructor_staff_id)
    left join core.people person on person.id = staff.person_id
    where rule.academy_id = p_academy_id
      and (
        p_view = 'settings'
        or (
          rule.active
          and rule.start_date <= p_end_date
          and (rule.end_date is null or rule.end_date >= p_start_date)
        )
      )
    order by rule.day_of_week, rule.start_time, rule.id
    limit 1001
  ),
  occurrences as materialized (
    select
      occurrence.id,
      occurrence.class_id,
      c.name as class_name,
      occurrence.rule_id,
      occurrence.occurrence_date,
      occurrence.start_time,
      occurrence.end_time,
      occurrence.status,
      coalesce(occurrence.classroom_id, cp.default_classroom_id) as classroom_id,
      classroom.name as classroom_name,
      coalesce(
        occurrence.substitute_staff_id,
        occurrence.instructor_staff_id,
        cp.default_instructor_staff_id
      ) as instructor_id,
      coalesce(person.display_name, person.full_name) as instructor_name,
      occurrence.cancel_reason
    from lms.lesson_occurrences occurrence
    join selected_classes c on c.id = occurrence.class_id
    left join lms.class_profiles cp on cp.class_id = occurrence.class_id
    left join lms.classrooms classroom
      on classroom.id = coalesce(occurrence.classroom_id, cp.default_classroom_id)
    left join core.staff_members staff
      on staff.id = coalesce(
        occurrence.substitute_staff_id,
        occurrence.instructor_staff_id,
        cp.default_instructor_staff_id
      )
    left join core.people person on person.id = staff.person_id
    where occurrence.academy_id = p_academy_id
      and occurrence.occurrence_date between p_start_date and p_end_date
      and p_view in ('overview', 'schedule', 'attendance')
    order by occurrence.occurrence_date, occurrence.start_time, occurrence.id
    limit 2001
  ),
  attendance as materialized (
    select
      record.id,
      record.occurrence_id,
      record.student_id,
      coalesce(person.display_name, person.full_name) as student_name,
      occurrence.class_id,
      c.name as class_name,
      occurrence.occurrence_date,
      occurrence.start_time,
      occurrence.end_time,
      record.status,
      record.attended_minutes,
      record.billable_minutes,
      record.notes
    from lms.attendance_records record
    join lms.lesson_occurrences occurrence on occurrence.id = record.occurrence_id
    join selected_classes c on c.id = occurrence.class_id
    join core.students student on student.id = record.student_id
    join core.people person on person.id = student.person_id
    where record.academy_id = p_academy_id
      and occurrence.occurrence_date between p_start_date and p_end_date
      and p_view = 'attendance'
    order by occurrence.occurrence_date desc, occurrence.start_time desc, record.created_at desc
    limit 2001
  ),
  book_candidates as materialized (
    select b.id, b.book_key, b.title, b.subject, b.grade
    from content.books b
    where (b.academy_id is null or b.academy_id = p_academy_id)
      and coalesce(b.metadata->>'visibility', '') <> 'assignment_hidden'
      and p_view in ('overview', 'settings')
    order by b.title, b.id
    limit 201
  ),
  staff_candidates as materialized (
    select
      staff.id,
      staff.person_id,
      coalesce(person.display_name, person.full_name) as name,
      staff.role,
      staff.status,
      staff.hourly_rate
    from core.staff_members staff
    join core.people person on person.id = staff.person_id
    where staff.academy_id = p_academy_id
      and staff.role in ('owner', 'admin', 'staff', 'teacher', 'instructor')
      and p_view = 'settings'
    order by coalesce(person.display_name, person.full_name), staff.id
    limit 501
  ),
  classroom_candidates as materialized (
    select classroom.id, classroom.name, classroom.capacity, classroom.color, classroom.active
    from lms.classrooms classroom
    where classroom.academy_id = p_academy_id
      and p_view = 'settings'
    order by classroom.name, classroom.id
    limit 201
  )
  select jsonb_build_object(
    'schemaVersion', 2,
    'academyId', p_academy_id,
    'view', p_view,
    'window', jsonb_build_object('from', p_start_date, 'to', p_end_date),
    'limits', jsonb_build_object(
      'classes', least(greatest(coalesce(p_class_limit, 100), 1), 100),
      'rules', 1000,
      'occurrences', 2000,
      'attendance', 2000,
      'books', 200,
      'staff', 500,
      'classrooms', 200,
      'maxWindowDays', 93
    ),
    'truncated', jsonb_build_object(
      'classes', exists (
        select 1
        from class_candidates
        offset least(greatest(coalesce(p_class_limit, 100), 1), 100)
      ),
      'scheduleRules', exists (select 1 from schedule_rules offset 1000),
      'occurrences', exists (select 1 from occurrences offset 2000),
      'attendance', exists (select 1 from attendance offset 2000),
      'books', exists (select 1 from book_candidates offset 200),
      'staff', exists (select 1 from staff_candidates offset 500),
      'classrooms', exists (select 1 from classroom_candidates offset 200)
    ),
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', summary.id,
        'name', summary.name,
        'grade', summary.grade,
        'active', summary.active,
        'status', summary.status,
        'color', summary.color,
        'capacity', summary.capacity,
        'defaultInstructorId', summary.default_instructor_staff_id,
        'defaultClassroomId', summary.default_classroom_id,
        'courseTitle', summary.course_title,
        'instructorName', summary.instructor_name,
        'classroomName', summary.classroom_name,
        'studentCount', summary.student_count,
        'weakTypeCount', summary.weak_type_count,
        'avgTypeScore', summary.avg_type_score,
        'lastLearningAt', summary.last_learning_at
      ) order by summary.name, summary.id)
      from class_summaries summary
    ), '[]'::jsonb),
    'scheduleRules', case when p_view in ('overview', 'schedule', 'attendance', 'settings') then coalesce((
      select jsonb_agg(to_jsonb(rule) order by rule.day_of_week, rule.start_time, rule.id)
      from (
        select *
        from schedule_rules
        order by day_of_week, start_time, id
        limit 1000
      ) rule
    ), '[]'::jsonb) else '[]'::jsonb end,
    'occurrences', case when p_view in ('overview', 'schedule', 'attendance') then coalesce((
      select jsonb_agg(to_jsonb(occurrence) order by occurrence.occurrence_date, occurrence.start_time, occurrence.id)
      from (
        select *
        from occurrences
        order by occurrence_date, start_time, id
        limit 2000
      ) occurrence
    ), '[]'::jsonb) else '[]'::jsonb end,
    'attendance', case when p_view = 'attendance' then coalesce((
      select jsonb_agg(to_jsonb(record) order by record.occurrence_date desc, record.start_time desc, record.id)
      from (
        select *
        from attendance
        order by occurrence_date desc, start_time desc, id
        limit 2000
      ) record
    ), '[]'::jsonb) else '[]'::jsonb end,
    'books', case when p_view in ('overview', 'settings') then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', book.id,
        'bookKey', book.book_key,
        'title', book.title,
        'subject', book.subject,
        'grade', book.grade
      ) order by book.title, book.id)
      from (
        select *
        from book_candidates
        order by title, id
        limit 200
      ) book
    ), '[]'::jsonb) else '[]'::jsonb end,
    'staff', case when p_view = 'settings' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', staff.id,
        'personId', staff.person_id,
        'name', staff.name,
        'role', staff.role,
        'status', staff.status,
        'hourlyRate', staff.hourly_rate
      ) order by staff.name, staff.id)
      from (
        select *
        from staff_candidates
        order by name, id
        limit 500
      ) staff
    ), '[]'::jsonb) else '[]'::jsonb end,
    'classrooms', case when p_view = 'settings' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', classroom.id,
        'name', classroom.name,
        'capacity', classroom.capacity,
        'color', classroom.color,
        'active', classroom.active
      ) order by classroom.name, classroom.id)
      from (
        select *
        from classroom_candidates
        order by name, id
        limit 200
      ) classroom
    ), '[]'::jsonb) else '[]'::jsonb end
  ) into v_result;

  return v_result;
end;
$$;

comment on function lms.class_operations_read_v2(uuid, text, date, date, uuid[], integer) is
  'Bounded one-call class operations payload with explicit truncation signals for every limited collection.';

revoke all on function lms.class_operations_read_v2(uuid, text, date, date, uuid[], integer) from public, anon;
grant execute on function lms.class_operations_read_v2(uuid, text, date, date, uuid[], integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Transactional mutation API

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
  ) then
    raise exception using errcode = '22023', message = 'The requested book is unavailable to this academy.';
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
    and p.book_id = p_book_id;
  if v_expected_count <> cardinality(v_problem_ids) then
    raise exception using errcode = '22023', message = 'Every problem must exist in the requested book and be accessible.';
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
  'Atomically creates an assignment, ordered item snapshot, targets, recipient snapshot, and one v2 logical event.';

revoke all on function learning.create_assignment_v2(uuid, uuid, text, text[], uuid[], uuid[], text, text, timestamptz, timestamptz, jsonb, uuid[], uuid, text)
  from public, anon;
grant execute on function learning.create_assignment_v2(uuid, uuid, text, text[], uuid[], uuid[], text, text, timestamptz, timestamptz, jsonb, uuid[], uuid, text)
  to authenticated, service_role;
