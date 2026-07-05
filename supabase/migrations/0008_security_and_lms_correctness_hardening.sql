-- Security and LMS correctness hardening.
-- Applies the immediate production fixes without rewriting the historical
-- migrations that may already be applied on a remote project.

create or replace function lms.has_academy_role(check_academy_id bigint, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = lms, public
as $$
  select exists (
    select 1
    from lms.academy_members m
    where m.user_id = (select auth.uid())
      and m.academy_id = check_academy_id
      and m.active
      and m.role = any(allowed_roles)
  )
$$;

grant execute on function lms.has_academy_role(bigint, text[]) to authenticated;

-- Do not provision LMS admins from public Auth signup metadata. Staff/admin
-- accounts must be created with an explicit profile + academy_members row.
create or replace function lms.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = lms, public
as $$
begin
  return new;
end;
$$;

-- Profiles may update only local security settings through RLS, not role,
-- academy, email, or identity fields.
revoke update on lms.profiles from authenticated;
grant update (pin_hash, idle_timeout) on lms.profiles to authenticated;

drop policy if exists profiles_self_update on lms.profiles;
create policy profiles_self_update on lms.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Split broad membership CRUD policies into read-for-members and
-- write-for-staff/admin policies.
do $$
declare
  table_name text;
  staff_write_roles text := 'array[''owner'',''admin'',''staff'']';
  admin_write_roles text := 'array[''owner'',''admin'']';
  write_roles text;
begin
  foreach table_name in array array[
    'classrooms', 'instructors', 'students', 'courses', 'lessons', 'enrollments',
    'account_types', 'transactions', 'student_payments', 'instructor_payments',
    'expenses', 'other_income', 'settings'
  ]
  loop
    write_roles := case
      when table_name = 'settings' then admin_write_roles
      else staff_write_roles
    end;

    execute format('drop policy if exists %I on lms.%I', table_name || '_academy_all', table_name);
    execute format('drop policy if exists %I on lms.%I', table_name || '_academy_select', table_name);
    execute format('drop policy if exists %I on lms.%I', table_name || '_academy_insert', table_name);
    execute format('drop policy if exists %I on lms.%I', table_name || '_academy_update', table_name);
    execute format('drop policy if exists %I on lms.%I', table_name || '_academy_delete', table_name);

    execute format(
      'create policy %I on lms.%I for select to authenticated using (lms.belongs_to_current_academy(academy_id))',
      table_name || '_academy_select',
      table_name
    );
    execute format(
      'create policy %I on lms.%I for insert to authenticated with check (lms.has_academy_role(academy_id, %s::text[]))',
      table_name || '_academy_insert',
      table_name,
      write_roles
    );
    execute format(
      'create policy %I on lms.%I for update to authenticated using (lms.has_academy_role(academy_id, %s::text[])) with check (lms.has_academy_role(academy_id, %s::text[]))',
      table_name || '_academy_update',
      table_name,
      write_roles,
      write_roles
    );
    execute format(
      'create policy %I on lms.%I for delete to authenticated using (lms.has_academy_role(academy_id, %s::text[]))',
      table_name || '_academy_delete',
      table_name,
      write_roles
    );
  end loop;
end $$;

drop policy if exists lesson_rules_academy_all on lms.lesson_rules;
drop policy if exists lesson_rules_academy_select on lms.lesson_rules;
drop policy if exists lesson_rules_academy_insert on lms.lesson_rules;
drop policy if exists lesson_rules_academy_update on lms.lesson_rules;
drop policy if exists lesson_rules_academy_delete on lms.lesson_rules;

create policy lesson_rules_academy_select on lms.lesson_rules
  for select to authenticated
  using (
    exists (
      select 1 from lms.lessons l
      where l.id = lesson_rules.lesson_id
        and lms.belongs_to_current_academy(l.academy_id)
    )
  );

create policy lesson_rules_academy_insert on lms.lesson_rules
  for insert to authenticated
  with check (
    exists (
      select 1 from lms.lessons l
      where l.id = lesson_rules.lesson_id
        and lms.has_academy_role(l.academy_id, array['owner','admin','staff']::text[])
    )
  );

create policy lesson_rules_academy_update on lms.lesson_rules
  for update to authenticated
  using (
    exists (
      select 1 from lms.lessons l
      where l.id = lesson_rules.lesson_id
        and lms.has_academy_role(l.academy_id, array['owner','admin','staff']::text[])
    )
  )
  with check (
    exists (
      select 1 from lms.lessons l
      where l.id = lesson_rules.lesson_id
        and lms.has_academy_role(l.academy_id, array['owner','admin','staff']::text[])
    )
  );

create policy lesson_rules_academy_delete on lms.lesson_rules
  for delete to authenticated
  using (
    exists (
      select 1 from lms.lessons l
      where l.id = lesson_rules.lesson_id
        and lms.has_academy_role(l.academy_id, array['owner','admin','staff']::text[])
    )
  );

drop policy if exists lesson_schedules_academy_all on lms.lesson_schedules;
drop policy if exists lesson_schedules_academy_select on lms.lesson_schedules;
drop policy if exists lesson_schedules_academy_insert on lms.lesson_schedules;
drop policy if exists lesson_schedules_academy_update on lms.lesson_schedules;
drop policy if exists lesson_schedules_academy_delete on lms.lesson_schedules;

create policy lesson_schedules_academy_select on lms.lesson_schedules
  for select to authenticated
  using (
    exists (
      select 1 from lms.lessons l
      where l.id = lesson_schedules.lesson_id
        and lms.belongs_to_current_academy(l.academy_id)
    )
  );

create policy lesson_schedules_academy_insert on lms.lesson_schedules
  for insert to authenticated
  with check (
    exists (
      select 1 from lms.lessons l
      where l.id = lesson_schedules.lesson_id
        and lms.has_academy_role(l.academy_id, array['owner','admin','staff']::text[])
    )
  );

create policy lesson_schedules_academy_update on lms.lesson_schedules
  for update to authenticated
  using (
    exists (
      select 1 from lms.lessons l
      where l.id = lesson_schedules.lesson_id
        and lms.has_academy_role(l.academy_id, array['owner','admin','staff']::text[])
    )
  )
  with check (
    exists (
      select 1 from lms.lessons l
      where l.id = lesson_schedules.lesson_id
        and lms.has_academy_role(l.academy_id, array['owner','admin','staff']::text[])
    )
  );

create policy lesson_schedules_academy_delete on lms.lesson_schedules
  for delete to authenticated
  using (
    exists (
      select 1 from lms.lessons l
      where l.id = lesson_schedules.lesson_id
        and lms.has_academy_role(l.academy_id, array['owner','admin','staff']::text[])
    )
  );

drop policy if exists transaction_lines_academy_all on lms.transaction_lines;
drop policy if exists transaction_lines_academy_select on lms.transaction_lines;
drop policy if exists transaction_lines_academy_insert on lms.transaction_lines;
drop policy if exists transaction_lines_academy_update on lms.transaction_lines;
drop policy if exists transaction_lines_academy_delete on lms.transaction_lines;

create policy transaction_lines_academy_select on lms.transaction_lines
  for select to authenticated
  using (
    exists (
      select 1 from lms.transactions t
      where t.id = transaction_lines.transaction_id
        and lms.belongs_to_current_academy(t.academy_id)
    )
  );

create policy transaction_lines_academy_insert on lms.transaction_lines
  for insert to authenticated
  with check (
    exists (
      select 1 from lms.transactions t
      where t.id = transaction_lines.transaction_id
        and lms.has_academy_role(t.academy_id, array['owner','admin','staff']::text[])
    )
  );

create policy transaction_lines_academy_update on lms.transaction_lines
  for update to authenticated
  using (
    exists (
      select 1 from lms.transactions t
      where t.id = transaction_lines.transaction_id
        and lms.has_academy_role(t.academy_id, array['owner','admin','staff']::text[])
    )
  )
  with check (
    exists (
      select 1 from lms.transactions t
      where t.id = transaction_lines.transaction_id
        and lms.has_academy_role(t.academy_id, array['owner','admin','staff']::text[])
    )
  );

create policy transaction_lines_academy_delete on lms.transaction_lines
  for delete to authenticated
  using (
    exists (
      select 1 from lms.transactions t
      where t.id = transaction_lines.transaction_id
        and lms.has_academy_role(t.academy_id, array['owner','admin','staff']::text[])
    )
  );

-- Settings must be scoped by academy, not globally keyed.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'lms.settings'::regclass
      and conname = 'settings_pkey'
  ) then
    alter table lms.settings drop constraint settings_pkey;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'lms.settings'::regclass
      and conname = 'settings_academy_key_pkey'
  ) then
    alter table lms.settings
      add constraint settings_academy_key_pkey primary key (academy_id, key);
  end if;
end $$;

-- Payroll details expected by the web accounting UI and tax exports.
alter table lms.instructor_payments
  add column if not exists recipient_name text,
  add column if not exists gross_amount numeric(12, 2),
  add column if not exists withholding_type text not null default 'none',
  add column if not exists withholding_rate numeric(8, 4) not null default 0,
  add column if not exists withholding_tax numeric(12, 2) not null default 0,
  add column if not exists local_tax numeric(12, 2) not null default 0,
  add column if not exists net_amount numeric(12, 2),
  add column if not exists payment_method text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'lms.instructor_payments'::regclass
      and conname = 'instructor_payments_withholding_type_check'
  ) then
    alter table lms.instructor_payments
      add constraint instructor_payments_withholding_type_check
      check (withholding_type in ('freelance_3.3', 'other_8.8', 'employee', 'none'));
  end if;
end $$;

update lms.instructor_payments p
set recipient_name = i.name
from lms.instructors i
where p.instructor_id = i.id
  and p.recipient_name is null;

update lms.instructor_payments
set gross_amount = coalesce(gross_amount, amount),
    net_amount = coalesce(net_amount, amount),
    withholding_tax = coalesce(withholding_tax, 0),
    local_tax = coalesce(local_tax, 0),
    withholding_rate = coalesce(withholding_rate, 0),
    withholding_type = coalesce(withholding_type, 'none')
where gross_amount is null
   or net_amount is null
   or withholding_tax is null
   or local_tax is null
   or withholding_rate is null
   or withholding_type is null;

create index if not exists instructor_payments_academy_payment_date_idx
  on lms.instructor_payments (academy_id, payment_date desc);

-- Makeup schedules can override the lesson classroom and should keep one
-- canonical substitute status value.
alter table lms.lesson_schedules
  add column if not exists classroom_id bigint references lms.classrooms (id) on delete set null;

update lms.lesson_schedules s
set classroom_id = l.classroom_id
from lms.lessons l
where s.lesson_id = l.id
  and s.classroom_id is null;

update lms.lesson_schedules
set status = 'substitute'
where status = 'substituted';

alter table lms.lesson_schedules drop constraint if exists lesson_schedules_status_check;
alter table lms.lesson_schedules
  add constraint lesson_schedules_status_check
  check (status in ('scheduled', 'completed', 'cancelled', 'makeup', 'substitute'));

create index if not exists lesson_schedules_classroom_date_idx
  on lms.lesson_schedules (classroom_id, date)
  where classroom_id is not null;

-- Authenticated clients can read problem content, but not the answer payload.
-- Staff/server answer workflows should use service-role endpoints.
revoke select on content.problems from authenticated;
grant select (
  id,
  book_id,
  unit_id,
  type_id,
  concept_id,
  page_printed,
  number,
  image_path,
  position_in_type,
  is_example,
  difficulty_hint,
  verified,
  created_at,
  updated_at
) on content.problems to authenticated;
grant select on content.problems to service_role;

notify pgrst, 'reload schema';
