create index if not exists ai_conversations_assignment_fk_idx
  on ai.conversations (assignment_id)
  where assignment_id is not null;

create index if not exists ai_conversations_core_student_fk_idx
  on ai.conversations (core_student_id)
  where core_student_id is not null;
