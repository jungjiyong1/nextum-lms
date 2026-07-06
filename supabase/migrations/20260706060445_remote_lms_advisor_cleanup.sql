create or replace function core.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function lms.ensure_attendance_student_in_class()
returns trigger
language plpgsql
set search_path = lms, core, public
as $$
begin
  if not exists (
    select 1
    from lms.lesson_occurrences lo
    join core.class_students cs
      on cs.class_id = lo.class_id
     and cs.student_id = new.student_id
     and cs.status = 'active'
    where lo.id = new.occurrence_id
      and lo.academy_id = new.academy_id
  ) then
    raise exception 'Attendance student must be actively enrolled in the occurrence class.';
  end if;

  return new;
end;
$$;

drop policy if exists invitations_staff on core.account_invitations;
create policy invitations_staff on core.account_invitations for all to authenticated
  using (core.has_academy_role(academy_id, array['owner','admin','staff']))
  with check (core.has_academy_role(academy_id, array['owner','admin','staff']));

do $$
begin
  if to_regclass('ai.attachments') is not null then
    drop policy if exists ai_attachments_no_direct_access on ai.attachments;
    create policy ai_attachments_no_direct_access on ai.attachments
      for all to authenticated using (false) with check (false);
  end if;

  if to_regclass('audit.audit_logs') is not null then
    drop policy if exists audit_logs_no_direct_access on audit.audit_logs;
    create policy audit_logs_no_direct_access on audit.audit_logs
      for all to authenticated using (false) with check (false);
  end if;

  if to_regclass('learning.assignments') is not null then
    drop policy if exists learning_assignments_no_direct_access on learning.assignments;
    create policy learning_assignments_no_direct_access on learning.assignments
      for all to authenticated using (false) with check (false);
  end if;

  if to_regclass('learning.assignment_targets') is not null then
    drop policy if exists learning_assignment_targets_no_direct_access on learning.assignment_targets;
    create policy learning_assignment_targets_no_direct_access on learning.assignment_targets
      for all to authenticated using (false) with check (false);
  end if;

  if to_regclass('learning.book_assignments') is not null then
    drop policy if exists learning_book_assignments_no_direct_access on learning.book_assignments;
    create policy learning_book_assignments_no_direct_access on learning.book_assignments
      for all to authenticated using (false) with check (false);
  end if;
end;
$$;
