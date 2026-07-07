-- Snapshot assignment recipients so class roster changes do not rewrite
-- historical homework progress denominators.

create table if not exists learning.assignment_recipients (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references learning.assignments (id) on delete cascade,
  academy_id    uuid not null references core.academies (id) on delete cascade,
  student_id    uuid not null references core.students (id) on delete cascade,
  class_id      uuid references core.classes (id) on delete set null,
  source_type   text not null default 'manual_add'
                check (source_type in ('class_snapshot', 'student_direct', 'manual_add')),
  active        boolean not null default true,
  added_by      uuid references core.people (id) on delete set null,
  added_at      timestamptz not null default now(),
  removed_at    timestamptz,
  metadata      jsonb not null default '{}'::jsonb,
  unique (assignment_id, student_id)
);

create index if not exists learning_assignment_recipients_assignment_idx
  on learning.assignment_recipients (assignment_id, active);
create index if not exists learning_assignment_recipients_student_idx
  on learning.assignment_recipients (academy_id, student_id, active);
create index if not exists learning_assignment_recipients_class_idx
  on learning.assignment_recipients (academy_id, class_id, active)
  where class_id is not null;

insert into learning.assignment_recipients (
  assignment_id,
  academy_id,
  student_id,
  class_id,
  source_type,
  active,
  added_at
)
select
  a.id,
  a.academy_id,
  cs.student_id,
  t.class_id,
  'class_snapshot',
  true,
  coalesce(t.created_at, a.created_at, now())
from learning.assignments a
join learning.assignment_targets t
  on t.assignment_id = a.id
 and t.target_type = 'class'
 and t.class_id is not null
 and coalesce(t.active, true)
join core.class_students cs
  on cs.class_id = t.class_id
 and cs.status = 'active'
on conflict (assignment_id, student_id) do nothing;

insert into learning.assignment_recipients (
  assignment_id,
  academy_id,
  student_id,
  class_id,
  source_type,
  active,
  added_at
)
select
  a.id,
  a.academy_id,
  t.student_id,
  cs.class_id,
  'student_direct',
  true,
  coalesce(t.created_at, a.created_at, now())
from learning.assignments a
join learning.assignment_targets t
  on t.assignment_id = a.id
 and t.target_type = 'student'
 and t.student_id is not null
 and coalesce(t.active, true)
left join lateral (
  select class_id
  from core.class_students
  where student_id = t.student_id
    and status = 'active'
  order by primary_class desc, joined_at desc
  limit 1
) cs on true
on conflict (assignment_id, student_id) do nothing;

create or replace function learning.can_access_assignment(check_assignment_id uuid)
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
      and coalesce(a.active, true)
      and (
        core.has_academy_role(a.academy_id, array['owner','admin','staff'])
        or (
          coalesce(a.status, 'published') = 'published'
          and coalesce(a.available_from, '-infinity'::timestamptz) <= now()
          and (
            exists (
              select 1
              from learning.assignment_recipients r
              where r.assignment_id = a.id
                and r.active
                and r.student_id = core.current_student_id(a.academy_id)
            )
            or exists (
              select 1
              from learning.assignment_recipients r
              where r.assignment_id = a.id
                and r.active
                and core.has_academy_role(a.academy_id, array['teacher','instructor'])
                and (
                  (r.class_id is not null and core.can_access_assigned_class(r.class_id))
                  or core.can_access_student(r.student_id)
                )
            )
            or exists (
              select 1
              from learning.assignment_targets t
              where t.assignment_id = a.id
                and coalesce(t.active, true)
                and (
                  (
                    t.target_type = 'class'
                    and t.class_id is not null
                    and core.can_access_assigned_class(t.class_id)
                  )
                )
            )
          )
        )
      )
  )
$$;

alter table learning.assignment_recipients enable row level security;

drop policy if exists learning_assignment_targets_select on learning.assignment_targets;
create policy learning_assignment_targets_select on learning.assignment_targets
  for select to authenticated
  using (learning.can_access_assignment(assignment_id));

drop policy if exists learning_assignment_recipients_select on learning.assignment_recipients;
create policy learning_assignment_recipients_select on learning.assignment_recipients
  for select to authenticated
  using (
    core.has_academy_role(academy_id, array['owner','admin','staff'])
    or student_id = core.current_student_id(academy_id)
    or (
      core.has_academy_role(academy_id, array['teacher','instructor'])
      and (
        (class_id is not null and core.can_access_assigned_class(class_id))
        or core.can_access_student(student_id)
      )
    )
  );

drop policy if exists learning_assignment_recipients_write on learning.assignment_recipients;
create policy learning_assignment_recipients_write on learning.assignment_recipients
  for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));

grant select, insert, update, delete on learning.assignment_recipients to authenticated;

do $$
begin
  if to_regclass('learning.assignment_recipients') is not null
     and to_regprocedure('core.broadcast_lms_invalidation()') is not null then
    drop trigger if exists broadcast_lms_invalidation on learning.assignment_recipients;
    create trigger broadcast_lms_invalidation
      after insert or update or delete on learning.assignment_recipients
      for each row execute function core.broadcast_lms_invalidation();
  end if;
end;
$$;
