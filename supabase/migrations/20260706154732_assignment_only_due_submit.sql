-- Move grade-app student access to assignment-first solving.
-- Students may still view assigned assignments after due_at, but inserts for
-- sessions/attempts require an active submit window.

do $$
begin
  if exists (
    select 1
    from learning.assignment_targets
    where target_type not in ('class', 'student')
  ) then
    raise exception 'Cannot migrate assignment_targets: academy/lesson targets still exist.';
  end if;
end;
$$;

alter table learning.assignment_targets
  drop constraint if exists assignment_targets_check;
alter table learning.assignment_targets
  drop constraint if exists assignment_targets_target_type_check;

alter table learning.assignment_targets
  add constraint assignment_targets_target_type_check
  check (target_type in ('class', 'student'));

alter table learning.assignment_targets
  add constraint assignment_targets_check
  check (
    (target_type = 'class' and class_id is not null and student_id is null)
    or (target_type = 'student' and student_id is not null and class_id is null)
  );

create unique index if not exists learning_assignment_targets_class_unique
  on learning.assignment_targets (assignment_id, class_id)
  where target_type = 'class' and class_id is not null;

create unique index if not exists learning_assignment_targets_student_unique
  on learning.assignment_targets (assignment_id, student_id)
  where target_type = 'student' and student_id is not null;

create or replace function learning.can_submit_assignment(check_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = learning, core, public
as $$
  select exists (
    select 1
    from learning.assignments a
    where a.id = check_assignment_id
      and learning.can_access_assignment(a.id)
      and (a.due_at is null or now() <= a.due_at)
  )
$$;

create or replace function learning.can_access_problem(check_problem_id text)
returns boolean
language sql
stable
security definer
set search_path = learning, content, core, public
as $$
  select exists (
    select 1
    from content.problems p
    left join content.books b on b.id = p.book_id
    where p.id = check_problem_id
      and (
        (b.academy_id is not null and core.has_academy_role(b.academy_id, array['owner','admin','staff']))
        or exists (
          select 1
          from learning.assignment_items item
          where item.problem_id = p.id
            and learning.can_access_assignment(item.assignment_id)
        )
        or exists (
          select 1
          from learning.assignments a
          where learning.can_access_assignment(a.id)
            and a.book_id = p.book_id
            and (a.unit_id is null or a.unit_id = p.unit_id)
            and (a.problem_id is null or a.problem_id = p.id)
        )
      )
  )
$$;

drop policy if exists learning_sessions_insert_own on learning.sessions;
create policy learning_sessions_insert_own on learning.sessions for insert to authenticated
  with check (
    assignment_id is not null
    and core_student_id = core.current_student_id(academy_id)
    and learning.can_submit_assignment(assignment_id)
  );

drop policy if exists learning_attempts_insert_own on learning.attempts;
create policy learning_attempts_insert_own on learning.attempts for insert to authenticated
  with check (
    assignment_id is not null
    and core_student_id = core.current_student_id(academy_id)
    and learning.can_submit_assignment(assignment_id)
    and learning.can_access_problem(problem_id)
  );

grant execute on function learning.can_submit_assignment(uuid) to authenticated;
