-- Point learning activity at canonical content/core tables while preserving
-- legacy student_id for current auth.uid based RLS and old clients.

create table if not exists content.assets (
  id uuid primary key default gen_random_uuid(),
  book_id uuid references content.books (id) on delete cascade,
  problem_id text references content.problems (id) on delete cascade,
  storage_path text not null,
  asset_type text not null default 'image',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table content.assets enable row level security;

drop policy if exists content_authenticated_read_assets on content.assets;
create policy content_authenticated_read_assets on content.assets
  for select to authenticated using (true);

grant select on content.assets to authenticated;
grant all on content.assets to service_role;

alter table learning.sessions drop constraint if exists sessions_student_id_fkey;
alter table learning.attempts drop constraint if exists attempts_student_id_fkey;
alter table learning.wrong_notes drop constraint if exists wrong_notes_student_id_fkey;
alter table learning.reports drop constraint if exists reports_student_id_fkey;

alter table learning.sessions drop constraint if exists sessions_book_id_fkey;
alter table learning.sessions
  add constraint sessions_book_content_fk
  foreign key (book_id) references content.books (id) on delete restrict;

alter table learning.attempts drop constraint if exists attempts_problem_id_fkey;
alter table learning.attempts
  add constraint attempts_problem_content_fk
  foreign key (problem_id) references content.problems (id) on delete restrict;

alter table learning.wrong_notes drop constraint if exists wrong_notes_problem_id_fkey;
alter table learning.wrong_notes
  add constraint wrong_notes_problem_content_fk
  foreign key (problem_id) references content.problems (id) on delete restrict;

alter table learning.reports drop constraint if exists reports_problem_id_fkey;
alter table learning.reports
  add constraint reports_problem_content_fk
  foreign key (problem_id) references content.problems (id) on delete restrict;

create or replace view reporting.student_problem_weakness
with (security_invoker = on)
as
with first_tries as (
  select
    coalesce(a.core_student_id, cs.id) as core_student_id,
    a.student_id as legacy_auth_user_id,
    a.problem_id,
    bool_and(a.correct) as correct,
    bool_or(a.unsure) as unsure,
    max(a.created_at) as at
  from learning.attempts a
  left join core.students cs on cs.legacy_core_profile_id = a.student_id
  where a.attempt_no = 1
  group by coalesce(a.core_student_id, cs.id), a.student_id, a.problem_id
),
scored as (
  select
    f.core_student_id,
    f.legacy_auth_user_id,
    p.book_id,
    p.unit_id,
    p.type_id,
    coalesce(p.concept_id, pt.concept_id) as concept_id,
    case when f.correct and f.unsure then 0.5
         when f.correct then 1.0
         else 0.0 end as score,
    f.at
  from first_tries f
  join content.problems p on p.id = f.problem_id
  left join content.problem_types pt on pt.id = p.type_id
)
select
  s.core_student_id as student_id,
  s.core_student_id,
  s.legacy_auth_user_id,
  s.book_id,
  s.unit_id,
  u.name as unit_name,
  s.concept_id,
  c.name as concept_name,
  s.type_id,
  pt.name as type_name,
  count(*)::int as n_first_try,
  sum(s.score) as first_try_correct,
  max(s.at) as last_attempt_at,
  case
    when count(*) < 2 then 'insufficient'
    when sum(s.score) / count(*) < 0.5 then 'weak'
    when sum(s.score) / count(*) < 0.75 then 'watch'
    else 'ok'
  end as status
from scored s
join content.units u on u.id = s.unit_id
left join content.concepts c on c.id = s.concept_id
left join content.problem_types pt on pt.id = s.type_id
group by
  s.core_student_id, s.legacy_auth_user_id, s.book_id, s.unit_id, u.name,
  s.concept_id, c.name, s.type_id, pt.name;

grant select on reporting.student_problem_weakness to authenticated, service_role;

notify pgrst, 'reload schema';
