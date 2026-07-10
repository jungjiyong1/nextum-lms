-- Make learning the canonical access layer for grade-app/LMS.
-- core.class_books remains as compatibility data, but new read/write paths use
-- learning.book_assignments and learning.assignments.

create table if not exists learning.book_assignments (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references core.academies (id) on delete cascade,
  book_id     uuid not null references content.books (id) on delete cascade,
  target_type text not null check (target_type in ('class', 'student')),
  class_id    uuid references core.classes (id) on delete cascade,
  student_id  uuid references core.students (id) on delete cascade,
  active      boolean not null default true,
  assigned_by uuid references core.people (id) on delete set null,
  assigned_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (
    (target_type = 'class' and class_id is not null and student_id is null)
    or (target_type = 'student' and student_id is not null and class_id is null)
  )
);

create table if not exists learning.assignments (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references core.academies (id) on delete cascade,
  book_id     uuid references content.books (id) on delete cascade,
  unit_id     uuid references content.units (id) on delete set null,
  problem_id  text references content.problems (id) on delete set null,
  title       text not null,
  description text,
  context     text not null default 'homework',
  due_at      timestamptz,
  created_by  uuid references core.people (id) on delete set null,
  active      boolean not null default true,
  source_type text not null default 'content_scope',
  status      text not null default 'published',
  published_at timestamptz,
  available_from timestamptz,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists learning.assignment_targets (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references learning.assignments (id) on delete cascade,
  target_type   text not null check (target_type in ('class', 'student')),
  class_id      uuid references core.classes (id) on delete cascade,
  student_id    uuid references core.students (id) on delete cascade,
  lms_lesson_id uuid,
  active        boolean not null default true,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  check (
    (target_type = 'class' and class_id is not null and student_id is null)
    or (target_type = 'student' and student_id is not null and class_id is null)
  )
);

create table if not exists learning.assignment_items (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references learning.assignments (id) on delete cascade,
  book_id       uuid references content.books (id) on delete cascade,
  unit_id       uuid references content.units (id) on delete set null,
  problem_id    text references content.problems (id) on delete cascade,
  sort_order    integer not null default 0,
  points        numeric(10, 2),
  required      boolean not null default true,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists learning.assignment_files (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references learning.assignments (id) on delete cascade,
  storage_path  text not null,
  file_name     text,
  media_type    text,
  display_order integer not null default 0,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

alter table learning.book_assignments add column if not exists academy_id uuid references core.academies (id) on delete cascade;
alter table learning.book_assignments add column if not exists book_id uuid references content.books (id) on delete cascade;
alter table learning.book_assignments add column if not exists target_type text;
alter table learning.book_assignments add column if not exists class_id uuid references core.classes (id) on delete cascade;
alter table learning.book_assignments add column if not exists student_id uuid references core.students (id) on delete cascade;
alter table learning.book_assignments add column if not exists active boolean not null default true;
alter table learning.book_assignments add column if not exists assigned_by uuid references core.people (id) on delete set null;
alter table learning.book_assignments add column if not exists assigned_at timestamptz not null default now();
alter table learning.book_assignments add column if not exists created_at timestamptz not null default now();
alter table learning.book_assignments add column if not exists updated_at timestamptz not null default now();

alter table learning.assignments add column if not exists academy_id uuid references core.academies (id) on delete cascade;
alter table learning.assignments add column if not exists book_id uuid references content.books (id) on delete cascade;
alter table learning.assignments add column if not exists unit_id uuid references content.units (id) on delete set null;
alter table learning.assignments add column if not exists problem_id text references content.problems (id) on delete set null;
alter table learning.assignments add column if not exists title text;
alter table learning.assignments add column if not exists description text;
alter table learning.assignments add column if not exists context text not null default 'homework';
alter table learning.assignments add column if not exists due_at timestamptz;
alter table learning.assignments add column if not exists created_by uuid references core.people (id) on delete set null;
alter table learning.assignments add column if not exists active boolean not null default true;
alter table learning.assignments add column if not exists source_type text not null default 'content_scope';
alter table learning.assignments add column if not exists status text not null default 'published';
alter table learning.assignments add column if not exists published_at timestamptz;
alter table learning.assignments add column if not exists available_from timestamptz;
alter table learning.assignments add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table learning.assignments add column if not exists created_at timestamptz not null default now();
alter table learning.assignments add column if not exists updated_at timestamptz not null default now();

alter table learning.assignment_targets add column if not exists assignment_id uuid references learning.assignments (id) on delete cascade;
alter table learning.assignment_targets add column if not exists target_type text;
alter table learning.assignment_targets add column if not exists class_id uuid references core.classes (id) on delete cascade;
alter table learning.assignment_targets add column if not exists student_id uuid references core.students (id) on delete cascade;
alter table learning.assignment_targets add column if not exists lms_lesson_id uuid;
alter table learning.assignment_targets add column if not exists active boolean not null default true;
alter table learning.assignment_targets add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table learning.assignment_targets add column if not exists created_at timestamptz not null default now();

alter table learning.sessions add column if not exists assignment_id uuid references learning.assignments (id) on delete set null;
alter table learning.attempts add column if not exists assignment_id uuid references learning.assignments (id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'learning_assignments_source_type_check'
  ) then
    alter table learning.assignments
      add constraint learning_assignments_source_type_check
      check (source_type in ('content_scope', 'worksheet'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'learning_assignments_status_check'
  ) then
    alter table learning.assignments
      add constraint learning_assignments_status_check
      check (status in ('draft', 'published', 'archived'));
  end if;
end;
$$;

create unique index if not exists learning_book_assignments_class_unique
  on learning.book_assignments (academy_id, book_id, class_id)
  where target_type = 'class' and class_id is not null;

create unique index if not exists learning_book_assignments_student_unique
  on learning.book_assignments (academy_id, book_id, student_id)
  where target_type = 'student' and student_id is not null;

create unique index if not exists learning_assignment_targets_class_unique
  on learning.assignment_targets (assignment_id, class_id)
  where target_type = 'class' and class_id is not null;

create unique index if not exists learning_assignment_targets_student_unique
  on learning.assignment_targets (assignment_id, student_id)
  where target_type = 'student' and student_id is not null;

create unique index if not exists learning_assignment_items_problem_unique
  on learning.assignment_items (assignment_id, problem_id)
  where problem_id is not null;

create index if not exists learning_book_assignments_book_idx on learning.book_assignments (book_id);
create index if not exists learning_book_assignments_class_idx on learning.book_assignments (class_id) where class_id is not null;
create index if not exists learning_book_assignments_student_idx on learning.book_assignments (student_id) where student_id is not null;
create index if not exists learning_assignment_targets_assignment_idx on learning.assignment_targets (assignment_id);
create index if not exists learning_assignment_targets_class_idx on learning.assignment_targets (class_id) where class_id is not null;
create index if not exists learning_assignment_targets_student_idx on learning.assignment_targets (student_id) where student_id is not null;
create index if not exists learning_assignment_items_assignment_idx on learning.assignment_items (assignment_id, sort_order);
create index if not exists learning_assignment_items_problem_idx on learning.assignment_items (problem_id) where problem_id is not null;
create index if not exists learning_sessions_assignment_idx on learning.sessions (assignment_id) where assignment_id is not null;
create index if not exists learning_attempts_assignment_idx on learning.attempts (assignment_id) where assignment_id is not null;

insert into learning.book_assignments (
  academy_id,
  book_id,
  target_type,
  class_id,
  active,
  assigned_at,
  created_at,
  updated_at
)
select
  c.academy_id,
  cb.book_id,
  'class',
  cb.class_id,
  cb.active,
  coalesce(cb.assigned_at, now()),
  coalesce(cb.assigned_at, now()),
  now()
from core.class_books cb
join core.classes c on c.id = cb.class_id
where not exists (
  select 1
  from learning.book_assignments ba
  where ba.academy_id = c.academy_id
    and ba.book_id = cb.book_id
    and ba.target_type = 'class'
    and ba.class_id = cb.class_id
);

create or replace function learning.can_access_book(check_book_id uuid)
returns boolean
language sql
stable
security definer
set search_path = learning, core, content, public
as $$
  select exists (
    select 1
    from content.books b
    where b.id = check_book_id
      and (
        (b.academy_id is not null and core.has_academy_role(b.academy_id, array['owner','admin','staff']))
        or exists (
          select 1
          from learning.book_assignments ba
          left join core.classes c on c.id = ba.class_id
          where ba.book_id = b.id
            and ba.active
            and (
              core.has_academy_role(ba.academy_id, array['owner','admin','staff'])
              or (
                ba.target_type = 'student'
                and ba.student_id = core.current_student_id(ba.academy_id)
              )
              or (
                ba.target_type = 'class'
                and exists (
                  select 1
                  from core.class_students cs
                  where cs.class_id = ba.class_id
                    and cs.student_id = core.current_student_id(ba.academy_id)
                    and cs.status = 'active'
                )
              )
              or (
                ba.target_type = 'class'
                and c.id is not null
                and core.can_access_assigned_class(c.id)
              )
            )
        )
      )
  )
$$;

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
          and exists (
            select 1
            from learning.assignment_targets t
            where t.assignment_id = a.id
              and coalesce(t.active, true)
              and (
                (
                  t.target_type = 'student'
                  and t.student_id = core.current_student_id(a.academy_id)
                )
                or (
                  t.target_type = 'class'
                  and exists (
                    select 1
                    from core.class_students cs
                    where cs.class_id = t.class_id
                      and cs.student_id = core.current_student_id(a.academy_id)
                      and cs.status = 'active'
                  )
                )
                or (
                  t.target_type = 'class'
                  and t.class_id is not null
                  and core.can_access_assigned_class(t.class_id)
                )
              )
          )
        )
      )
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
    where p.id = check_problem_id
      and (
        learning.can_access_book(p.book_id)
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

create or replace function content.can_report_problem(check_problem_id text)
returns boolean
language sql
stable
security invoker
set search_path = content, learning, core, public
as $$
  select learning.can_access_problem(check_problem_id)
$$;

drop policy if exists learning_book_assignments_no_direct_access on learning.book_assignments;
drop policy if exists learning_book_assignments_select on learning.book_assignments;
drop policy if exists learning_book_assignments_write on learning.book_assignments;
create policy learning_book_assignments_select on learning.book_assignments for select to authenticated
  using (
    core.has_academy_role(academy_id, array['owner','admin','staff'])
    or (target_type = 'student' and student_id = core.current_student_id(academy_id))
    or (
      target_type = 'class'
      and exists (
        select 1 from core.class_students cs
        where cs.class_id = book_assignments.class_id
          and cs.student_id = core.current_student_id(academy_id)
          and cs.status = 'active'
      )
    )
    or (target_type = 'class' and class_id is not null and core.can_access_assigned_class(class_id))
  );
create policy learning_book_assignments_write on learning.book_assignments for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));

drop policy if exists learning_assignments_no_direct_access on learning.assignments;
drop policy if exists learning_assignments_select on learning.assignments;
drop policy if exists learning_assignments_write on learning.assignments;
create policy learning_assignments_select on learning.assignments for select to authenticated
  using (learning.can_access_assignment(id));
create policy learning_assignments_write on learning.assignments for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));

drop policy if exists learning_assignment_targets_no_direct_access on learning.assignment_targets;
drop policy if exists learning_assignment_targets_select on learning.assignment_targets;
drop policy if exists learning_assignment_targets_write on learning.assignment_targets;
create policy learning_assignment_targets_select on learning.assignment_targets for select to authenticated
  using (
    exists (
      select 1
      from learning.assignments a
      where a.id = assignment_targets.assignment_id
        and (
          core.has_academy_role(a.academy_id, array['owner','admin','staff'])
          or (
            assignment_targets.target_type = 'student'
            and assignment_targets.student_id = core.current_student_id(a.academy_id)
          )
          or (
            assignment_targets.target_type = 'class'
            and exists (
              select 1
              from core.class_students cs
              where cs.class_id = assignment_targets.class_id
                and cs.student_id = core.current_student_id(a.academy_id)
                and cs.status = 'active'
            )
          )
          or (
            assignment_targets.target_type = 'class'
            and assignment_targets.class_id is not null
            and core.can_access_assigned_class(assignment_targets.class_id)
          )
        )
    )
  );
create policy learning_assignment_targets_write on learning.assignment_targets for all to authenticated
  using (
    exists (
      select 1 from learning.assignments a
      where a.id = assignment_targets.assignment_id
        and core.has_academy_role(a.academy_id, array['owner','admin','staff'])
    )
  )
  with check (
    exists (
      select 1 from learning.assignments a
      where a.id = assignment_targets.assignment_id
        and core.has_academy_role(a.academy_id, array['owner','admin','staff'])
    )
  );

alter table learning.book_assignments enable row level security;
alter table learning.assignments enable row level security;
alter table learning.assignment_targets enable row level security;
alter table learning.assignment_items enable row level security;
alter table learning.assignment_files enable row level security;

drop policy if exists learning_assignment_items_select on learning.assignment_items;
drop policy if exists learning_assignment_items_write on learning.assignment_items;
create policy learning_assignment_items_select on learning.assignment_items for select to authenticated
  using (learning.can_access_assignment(assignment_id));
create policy learning_assignment_items_write on learning.assignment_items for all to authenticated
  using (
    exists (
      select 1 from learning.assignments a
      where a.id = assignment_items.assignment_id
        and core.has_academy_role(a.academy_id, array['owner','admin','staff'])
    )
  )
  with check (
    exists (
      select 1 from learning.assignments a
      where a.id = assignment_items.assignment_id
        and core.has_academy_role(a.academy_id, array['owner','admin','staff'])
    )
  );

drop policy if exists learning_assignment_files_select on learning.assignment_files;
drop policy if exists learning_assignment_files_write on learning.assignment_files;
create policy learning_assignment_files_select on learning.assignment_files for select to authenticated
  using (learning.can_access_assignment(assignment_id));
create policy learning_assignment_files_write on learning.assignment_files for all to authenticated
  using (
    exists (
      select 1 from learning.assignments a
      where a.id = assignment_files.assignment_id
        and core.has_academy_role(a.academy_id, array['owner','admin','staff'])
    )
  )
  with check (
    exists (
      select 1 from learning.assignments a
      where a.id = assignment_files.assignment_id
        and core.has_academy_role(a.academy_id, array['owner','admin','staff'])
    )
  );

drop policy if exists content_books_select on content.books;
drop policy if exists content_units_select on content.units;
drop policy if exists content_concepts_select on content.concepts;
drop policy if exists content_problem_types_select on content.problem_types;
drop policy if exists content_problems_select on content.problems;
drop policy if exists content_assets_select on content.assets;

create policy content_books_select on content.books for select to authenticated
  using (
    learning.can_access_book(id)
    or exists (
      select 1
      from content.problems p
      where p.book_id = books.id
        and learning.can_access_problem(p.id)
    )
  );
create policy content_units_select on content.units for select to authenticated
  using (
    learning.can_access_book(book_id)
    or exists (
      select 1
      from content.problems p
      where p.unit_id = units.id
        and learning.can_access_problem(p.id)
    )
  );
create policy content_concepts_select on content.concepts for select to authenticated
  using (
    learning.can_access_book(book_id)
    or exists (
      select 1
      from content.problems p
      where p.concept_id = concepts.id
        and learning.can_access_problem(p.id)
    )
  );
create policy content_problem_types_select on content.problem_types for select to authenticated
  using (
    learning.can_access_book(book_id)
    or exists (
      select 1
      from content.problems p
      where (p.problem_type_id = problem_types.id or p.type_id = problem_types.id)
        and learning.can_access_problem(p.id)
    )
  );
create policy content_problems_select on content.problems for select to authenticated
  using (learning.can_access_problem(id));
create policy content_assets_select on content.assets for select to authenticated
  using (
    (book_id is not null and learning.can_access_book(book_id))
    or (problem_id is not null and learning.can_access_problem(problem_id))
  );

drop policy if exists learning_sessions_insert_own on learning.sessions;
create policy learning_sessions_insert_own on learning.sessions for insert to authenticated
  with check (
    core_student_id = core.current_student_id(academy_id)
    and (
      (assignment_id is null and learning.can_access_book(book_id))
      or (assignment_id is not null and learning.can_access_assignment(assignment_id))
    )
  );

drop policy if exists learning_attempts_insert_own on learning.attempts;
create policy learning_attempts_insert_own on learning.attempts for insert to authenticated
  with check (
    core_student_id = core.current_student_id(academy_id)
    and learning.can_access_problem(problem_id)
    and (
      assignment_id is null
      or learning.can_access_assignment(assignment_id)
    )
  );

grant usage on schema learning to authenticated;
grant execute on function learning.can_access_book(uuid) to authenticated;
grant execute on function learning.can_access_assignment(uuid) to authenticated;
grant execute on function learning.can_access_problem(text) to authenticated;
grant select on learning.book_assignments, learning.assignments, learning.assignment_targets, learning.assignment_items, learning.assignment_files to authenticated;
grant insert, update, delete on learning.book_assignments, learning.assignments, learning.assignment_targets, learning.assignment_items, learning.assignment_files to authenticated;
