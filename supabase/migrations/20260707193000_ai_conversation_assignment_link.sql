alter table ai.conversations
  add column if not exists assignment_id uuid references learning.assignments (id) on delete set null;

update ai.conversations c
set assignment_id = s.assignment_id
from learning.sessions s
where c.assignment_id is null
  and c.session_id = s.id
  and s.assignment_id is not null;

create index if not exists ai_conversations_assignment_student_idx
  on ai.conversations (academy_id, student_id, assignment_id, updated_at desc)
  where assignment_id is not null;

create index if not exists ai_conversations_core_assignment_idx
  on ai.conversations (academy_id, core_student_id, assignment_id, updated_at desc)
  where core_student_id is not null
    and assignment_id is not null;

comment on column ai.conversations.assignment_id is
  'Optional LMS assignment context for grade-app AI chat filtering in LMS student detail.';

grant select, insert, update on ai.conversations to authenticated;
