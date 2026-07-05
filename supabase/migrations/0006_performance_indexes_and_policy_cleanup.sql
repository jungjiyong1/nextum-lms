-- FK indexes and duplicate legacy policy cleanup.

create table if not exists ai.attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references ai.conversations (id) on delete cascade,
  message_id uuid references ai.messages (id) on delete cascade,
  storage_path text not null,
  media_type text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table ai.attachments enable row level security;

drop policy if exists ai_attachments_access on ai.attachments;
create policy ai_attachments_access on ai.attachments
  for all to authenticated
  using (
    exists (
      select 1 from ai.conversations c
      where c.id = attachments.conversation_id
        and (
          (c.student_id is not null and core.can_access_student(c.student_id))
          or (c.academy_id is not null and core.has_academy_role(c.academy_id, array['owner','admin','staff','instructor','teacher']))
        )
    )
  )
  with check (
    exists (
      select 1 from ai.conversations c
      where c.id = attachments.conversation_id
        and (
          (c.student_id is not null and core.can_access_student(c.student_id))
          or (c.academy_id is not null and core.has_academy_role(c.academy_id, array['owner','admin','staff','instructor','teacher']))
        )
    )
  );

create index if not exists ai_conversations_academy_idx on ai.conversations (academy_id);
create index if not exists ai_conversations_student_idx on ai.conversations (student_id);
create index if not exists ai_conversations_session_idx on ai.conversations (session_id);
create index if not exists ai_conversations_problem_idx on ai.conversations (problem_id);
create index if not exists ai_messages_conversation_idx on ai.messages (conversation_id);
create index if not exists ai_attachments_conversation_idx on ai.attachments (conversation_id);
create index if not exists ai_attachments_message_idx on ai.attachments (message_id);

create index if not exists audit_logs_academy_idx on audit.audit_logs (academy_id);
create index if not exists audit_logs_actor_person_idx on audit.audit_logs (actor_person_id);

create index if not exists content_assets_book_idx on content.assets (book_id);
create index if not exists content_assets_problem_idx on content.assets (problem_id);
create index if not exists content_problem_reports_student_idx on content.problem_reports (student_id);
create index if not exists content_problem_reports_auth_user_idx on content.problem_reports (legacy_auth_user_id);
create index if not exists content_problem_reports_problem_idx on content.problem_reports (problem_id);
create index if not exists content_problem_types_concept_idx on content.problem_types (concept_id);
create index if not exists content_problems_book_idx on content.problems (book_id);
create index if not exists content_problems_unit_idx on content.problems (unit_id);
create index if not exists content_problems_type_idx on content.problems (type_id);
create index if not exists content_problems_concept_idx on content.problems (concept_id);

create index if not exists core_academy_members_person_idx on core.academy_members (person_id);
create index if not exists core_academy_members_account_idx on core.academy_members (user_account_id);
create index if not exists core_account_invitations_academy_idx on core.account_invitations (academy_id);
create index if not exists core_account_invitations_person_idx on core.account_invitations (person_id);
create index if not exists core_account_invitations_student_idx on core.account_invitations (student_id);
create index if not exists core_account_invitations_staff_idx on core.account_invitations (staff_member_id);
create index if not exists core_account_invitations_accepted_auth_idx on core.account_invitations (accepted_auth_user_id);
create index if not exists core_account_invitations_created_by_idx on core.account_invitations (created_by);
create index if not exists core_class_books_book_idx on core.class_books (book_id);
create index if not exists core_class_students_student_idx on core.class_students (student_id);
create index if not exists core_profiles_academy_idx on core.profiles (academy_id);
create index if not exists core_staff_members_person_idx on core.staff_members (person_id);

create index if not exists data_events_academy_idx on data.events (academy_id);
create index if not exists data_events_student_idx on data.events (student_id);
create index if not exists data_events_student_time_idx on data.events (student_id, occurred_at desc);
create index if not exists data_events_academy_time_idx on data.events (academy_id, occurred_at desc);
create index if not exists data_events_type_time_idx on data.events (event_type, occurred_at desc);

create index if not exists learning_assignments_academy_idx on learning.assignments (academy_id);
create index if not exists learning_assignments_book_idx on learning.assignments (book_id);
create index if not exists learning_assignments_unit_idx on learning.assignments (unit_id);
create index if not exists learning_assignments_problem_idx on learning.assignments (problem_id);
create index if not exists learning_assignments_created_by_idx on learning.assignments (created_by);
create index if not exists learning_assignment_targets_assignment_idx on learning.assignment_targets (assignment_id);
create index if not exists learning_assignment_targets_student_idx on learning.assignment_targets (student_id);
create index if not exists learning_assignment_targets_lesson_idx on learning.assignment_targets (lms_lesson_id);

create index if not exists learning_sessions_book_idx on learning.sessions (book_id);
create index if not exists learning_sessions_core_student_idx on learning.sessions (core_student_id, started_at desc);
create index if not exists learning_attempts_core_student_idx on learning.attempts (core_student_id, created_at desc);
create index if not exists learning_wrong_notes_core_student_idx on learning.wrong_notes (core_student_id);
create index if not exists learning_reports_core_student_idx on learning.reports (core_student_id);

drop policy if exists sessions_own on learning.sessions;
drop policy if exists attempts_select_own on learning.attempts;
drop policy if exists attempts_insert_own on learning.attempts;

drop policy if exists assignments_staff_write on learning.assignments;

drop policy if exists assignments_staff_insert on learning.assignments;
create policy assignments_staff_insert on learning.assignments
  for insert to authenticated
  with check (core.has_academy_role(academy_id, array['owner','admin','staff','instructor','teacher']));

drop policy if exists assignments_staff_update on learning.assignments;
create policy assignments_staff_update on learning.assignments
  for update to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff','instructor','teacher']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff','instructor','teacher']));

drop policy if exists assignments_staff_delete on learning.assignments;
create policy assignments_staff_delete on learning.assignments
  for delete to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff','instructor','teacher']));

notify pgrst, 'reload schema';
