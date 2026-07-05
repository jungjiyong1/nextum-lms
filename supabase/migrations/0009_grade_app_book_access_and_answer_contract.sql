-- Grade-app hard-cut contract for the integrated schema.
-- - Book access is no longer inferred from learning.assignments.
-- - Student clients read only public problem payloads.
-- - Server/service-role workflows keep answer keys for grading and results.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Canonical class containers used by grade-app book access.
-- Older grade-app databases already have these tables. The statements below
-- make AMS migrations self-contained for projects created from the LMS side.

create table if not exists core.classes (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references core.academies (id) on delete cascade,
  name       text not null,
  grade      text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, name)
);

alter table core.classes
  add column if not exists academy_id uuid references core.academies (id) on delete cascade,
  add column if not exists grade text,
  add column if not exists active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists core.class_students (
  class_id   uuid not null references core.classes (id) on delete cascade,
  student_id uuid not null,
  joined_at  timestamptz not null default now(),
  primary key (class_id, student_id)
);

create table if not exists core.class_books (
  class_id    uuid not null references core.classes (id) on delete cascade,
  book_id     uuid not null references content.books (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (class_id, book_id)
);

alter table core.classes enable row level security;
alter table core.class_students enable row level security;
alter table core.class_books enable row level security;

drop trigger if exists set_classes_updated_at on core.classes;
create trigger set_classes_updated_at
  before update on core.classes
  for each row execute function core.set_updated_at();

create index if not exists core_classes_academy_idx on core.classes (academy_id);
create index if not exists core_class_students_student_idx on core.class_students (student_id);
create index if not exists core_class_books_book_idx on core.class_books (book_id);

drop policy if exists classes_access on core.classes;
create policy classes_access on core.classes
  for select to authenticated
  using (
    core.has_academy_role(academy_id, array['owner','admin','staff','instructor','teacher'])
    or exists (
      select 1
      from core.class_students cs
      join core.students s
        on s.id = core.current_student_id(classes.academy_id)
       and (cs.student_id = s.id or cs.student_id = s.legacy_core_profile_id)
      where cs.class_id = classes.id
    )
  );

drop policy if exists classes_staff_write on core.classes;
create policy classes_staff_write on core.classes
  for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff','instructor','teacher']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff','instructor','teacher']));

drop policy if exists class_students_access on core.class_students;
create policy class_students_access on core.class_students
  for select to authenticated
  using (
    exists (
      select 1
      from core.classes c
      where c.id = class_students.class_id
        and (
          core.has_academy_role(c.academy_id, array['owner','admin','staff','instructor','teacher'])
          or exists (
            select 1
            from core.students s
            where s.id = core.current_student_id(c.academy_id)
              and (class_students.student_id = s.id or class_students.student_id = s.legacy_core_profile_id)
          )
        )
    )
  );

drop policy if exists class_students_staff_write on core.class_students;
create policy class_students_staff_write on core.class_students
  for all to authenticated
  using (
    exists (
      select 1
      from core.classes c
      where c.id = class_students.class_id
        and core.has_academy_role(c.academy_id, array['owner','admin','staff','instructor','teacher'])
    )
  )
  with check (
    exists (
      select 1
      from core.classes c
      where c.id = class_students.class_id
        and core.has_academy_role(c.academy_id, array['owner','admin','staff','instructor','teacher'])
    )
  );

drop policy if exists class_books_access on core.class_books;
create policy class_books_access on core.class_books
  for select to authenticated
  using (
    exists (
      select 1
      from core.classes c
      where c.id = class_books.class_id
        and (
          core.has_academy_role(c.academy_id, array['owner','admin','staff','instructor','teacher'])
          or exists (
            select 1
            from core.class_students cs
            join core.students s
              on s.id = core.current_student_id(c.academy_id)
             and (cs.student_id = s.id or cs.student_id = s.legacy_core_profile_id)
            where cs.class_id = c.id
          )
        )
    )
  );

drop policy if exists class_books_staff_write on core.class_books;
create policy class_books_staff_write on core.class_books
  for all to authenticated
  using (
    exists (
      select 1
      from core.classes c
      where c.id = class_books.class_id
        and core.has_academy_role(c.academy_id, array['owner','admin','staff','instructor','teacher'])
    )
  )
  with check (
    exists (
      select 1
      from core.classes c
      where c.id = class_books.class_id
        and core.has_academy_role(c.academy_id, array['owner','admin','staff','instructor','teacher'])
    )
  );

grant select, insert, update, delete on core.classes, core.class_students, core.class_books to authenticated;
grant all on core.classes, core.class_students, core.class_books to service_role;

-- ---------------------------------------------------------------------------
-- Public answer payload / private answer key split.

create or replace function content.problem_public_payload(answer jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_strip_nulls(
    jsonb_build_object(
      'type', answer->>'type',
      'choice_count',
        case
          when answer ? 'choice_count' then nullif(answer->>'choice_count', '')::int
          when jsonb_typeof(answer->'choices') = 'array' then jsonb_array_length(answer->'choices')
          else null
        end,
      'required_count',
        case
          when answer->>'type' = 'choice'
           and answer ? 'multiple'
           and (answer->>'multiple')::boolean
          then greatest(1, cardinality(string_to_array(replace(coalesce(answer->>'normalized', ''), ' ', ''), ',')))
          else 1
        end,
      'choices',
        case when jsonb_typeof(answer->'choices') = 'array' then answer->'choices' end,
      'options',
        case
          when jsonb_typeof(answer->'choices') = 'array' then answer->'choices'
          when jsonb_typeof(answer->'distractors') = 'array' then (
            select jsonb_agg(option_value)
            from (
              select to_jsonb(answer->>'display') as option_value
              where nullif(answer->>'display', '') is not null
              union all
              select value as option_value
              from jsonb_array_elements(answer->'distractors') as d(value)
            ) options
          )
          else null
        end,
      'multiple',
        case when answer ? 'multiple' then (answer->>'multiple')::boolean else null end,
      'generated_choice',
        case when answer ? 'generated_choice' then (answer->>'generated_choice')::boolean else null end,
      'choice_generation_strategy', answer->>'choice_generation_strategy',
      'self_grade',
        (answer->>'type' = 'text')
        or (jsonb_typeof(answer->'subs') = 'array' and jsonb_array_length(answer->'subs') > 0),
      'subs',
        case
          when jsonb_typeof(answer->'subs') = 'array' then (
            select jsonb_agg(
              jsonb_strip_nulls(
                jsonb_build_object(
                  'label', sub->>'label',
                  'type', sub->>'type'
                )
              )
            )
            from jsonb_array_elements(answer->'subs') as s(sub)
          )
          else null
        end
    )
  )
$$;

alter table content.problems
  add column if not exists public_payload jsonb,
  add column if not exists answer_key jsonb;

update content.problems
set answer_key = coalesce(answer_key, answer),
    public_payload = coalesce(public_payload, content.problem_public_payload(answer))
where answer_key is null
   or public_payload is null;

alter table content.problems
  alter column answer_key set not null,
  alter column public_payload set not null;

create or replace function content.set_problem_answer_contract()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.answer_key := new.answer;
    new.public_payload := content.problem_public_payload(new.answer);
  elsif new.answer is distinct from old.answer then
    new.answer_key := new.answer;
    new.public_payload := content.problem_public_payload(new.answer);
  else
    new.answer_key := coalesce(new.answer_key, new.answer);
    new.public_payload := coalesce(new.public_payload, content.problem_public_payload(new.answer));
  end if;
  return new;
end;
$$;

drop trigger if exists set_problem_answer_contract on content.problems;
create trigger set_problem_answer_contract
  before insert or update of answer, answer_key, public_payload on content.problems
  for each row execute function content.set_problem_answer_contract();

-- ---------------------------------------------------------------------------
-- Book assignment contract. This is only for book visibility. Worksheet/test
-- assignments remain in learning.assignments for future app features.

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

alter table learning.book_assignments enable row level security;

drop trigger if exists set_book_assignments_updated_at on learning.book_assignments;
create trigger set_book_assignments_updated_at
  before update on learning.book_assignments
  for each row execute function core.set_updated_at();

insert into learning.book_assignments (academy_id, book_id, target_type, class_id, assigned_at)
select c.academy_id, cb.book_id, 'class', cb.class_id, cb.assigned_at
from core.class_books cb
join core.classes c on c.id = cb.class_id
where not exists (
  select 1
  from learning.book_assignments ba
  where ba.book_id = cb.book_id
    and ba.target_type = 'class'
    and ba.class_id = cb.class_id
);

create index if not exists learning_book_assignments_academy_idx
  on learning.book_assignments (academy_id);
create index if not exists learning_book_assignments_book_idx
  on learning.book_assignments (book_id);
create index if not exists learning_book_assignments_class_idx
  on learning.book_assignments (class_id)
  where target_type = 'class';
create index if not exists learning_book_assignments_student_idx
  on learning.book_assignments (student_id)
  where target_type = 'student';
create unique index if not exists learning_book_assignments_active_class_key
  on learning.book_assignments (book_id, class_id)
  where active and target_type = 'class';
create unique index if not exists learning_book_assignments_active_student_key
  on learning.book_assignments (book_id, student_id)
  where active and target_type = 'student';

create or replace function learning.can_access_book(check_book_id uuid)
returns boolean
language sql
stable
security definer
set search_path = learning, core, public
as $$
  select exists (
    select 1
    from learning.book_assignments ba
    where ba.book_id = check_book_id
      and ba.active
      and (
        core.has_academy_role(ba.academy_id, array['owner','admin','staff','instructor','teacher'])
        or (
          ba.target_type = 'student'
          and ba.student_id = core.current_student_id(ba.academy_id)
        )
        or (
          ba.target_type = 'class'
          and exists (
            select 1
            from core.class_students cs
            join core.students s
              on s.id = core.current_student_id(ba.academy_id)
             and (cs.student_id = s.id or cs.student_id = s.legacy_core_profile_id)
            where cs.class_id = ba.class_id
          )
        )
      )
  )
$$;

grant execute on function learning.can_access_book(uuid) to authenticated;

drop policy if exists book_assignments_select on learning.book_assignments;
create policy book_assignments_select on learning.book_assignments
  for select to authenticated
  using (
    core.has_academy_role(academy_id, array['owner','admin','staff','instructor','teacher'])
    or (
      target_type = 'student'
      and student_id = core.current_student_id(academy_id)
    )
    or (
      target_type = 'class'
      and exists (
        select 1
        from core.class_students cs
        join core.students s
          on s.id = core.current_student_id(book_assignments.academy_id)
         and (cs.student_id = s.id or cs.student_id = s.legacy_core_profile_id)
        where cs.class_id = book_assignments.class_id
      )
    )
  );

drop policy if exists book_assignments_staff_write on learning.book_assignments;
create policy book_assignments_staff_write on learning.book_assignments
  for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff','instructor','teacher']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff','instructor','teacher']));

grant select, insert, update, delete on learning.book_assignments to authenticated;
grant all on learning.book_assignments to service_role;

-- ---------------------------------------------------------------------------
-- Content visibility now follows book_assignments.

drop policy if exists content_authenticated_read_books on content.books;
create policy content_authenticated_read_books on content.books
  for select to authenticated
  using (learning.can_access_book(id));

drop policy if exists content_authenticated_read_units on content.units;
create policy content_authenticated_read_units on content.units
  for select to authenticated
  using (learning.can_access_book(book_id));

drop policy if exists content_authenticated_read_concepts on content.concepts;
create policy content_authenticated_read_concepts on content.concepts
  for select to authenticated
  using (learning.can_access_book(book_id));

drop policy if exists content_authenticated_read_problem_types on content.problem_types;
create policy content_authenticated_read_problem_types on content.problem_types
  for select to authenticated
  using (learning.can_access_book(book_id));

drop policy if exists content_authenticated_read_problems on content.problems;
create policy content_authenticated_read_problems on content.problems
  for select to authenticated
  using (learning.can_access_book(book_id));

drop policy if exists content_authenticated_read_assets on content.assets;
create policy content_authenticated_read_assets on content.assets
  for select to authenticated
  using (
    (book_id is not null and learning.can_access_book(book_id))
    or exists (
      select 1
      from content.problems p
      where p.id = assets.problem_id
        and learning.can_access_book(p.book_id)
    )
  );

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
  public_payload,
  position_in_type,
  is_example,
  difficulty_hint,
  verified,
  created_at,
  updated_at
) on content.problems to authenticated;
grant select on content.problems to service_role;

notify pgrst, 'reload schema';
