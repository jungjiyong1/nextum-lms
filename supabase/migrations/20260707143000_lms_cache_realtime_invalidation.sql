-- Realtime cache invalidation for LMS clients.
-- Broadcast payloads intentionally contain only routing metadata.

create or replace function core.uuid_or_null(value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if value is null or btrim(value) = '' then
    return null;
  end if;
  return value::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create or replace function core.broadcast_lms_invalidation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_academy_id uuid;
  v_student_id uuid;
  v_class_id uuid;
  v_assignment_id uuid;
  v_invoice_id uuid;
  v_conversation_id uuid;
  v_domain text := 'lms';
begin
  if TG_OP = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;

  v_academy_id := coalesce(
    core.uuid_or_null(v_row->>'academy_id'),
    core.uuid_or_null(v_row->>'primary_academy_id')
  );
  v_student_id := coalesce(
    core.uuid_or_null(v_row->>'student_id'),
    core.uuid_or_null(v_row->>'core_student_id')
  );
  v_class_id := core.uuid_or_null(v_row->>'class_id');
  v_assignment_id := core.uuid_or_null(v_row->>'assignment_id');
  v_invoice_id := core.uuid_or_null(v_row->>'invoice_id');
  v_conversation_id := core.uuid_or_null(v_row->>'conversation_id');

  if v_academy_id is null and TG_TABLE_SCHEMA = 'core' and TG_TABLE_NAME in ('class_students', 'class_books') then
    select c.academy_id into v_academy_id
      from core.classes c
     where c.id = v_class_id;
  end if;

  if v_academy_id is null and TG_TABLE_SCHEMA = 'lms' and TG_TABLE_NAME = 'invoice_lines' then
    select i.academy_id, i.student_id into v_academy_id, v_student_id
      from lms.invoices i
     where i.id = v_invoice_id;
  end if;

  if v_academy_id is null and TG_TABLE_SCHEMA = 'learning' and TG_TABLE_NAME in ('assignment_targets', 'assignment_items', 'assignment_files') then
    select a.academy_id into v_academy_id
      from learning.assignments a
     where a.id = v_assignment_id;
  end if;

  if TG_TABLE_SCHEMA = 'learning' and TG_TABLE_NAME in ('assignment_targets', 'assignment_items', 'assignment_files') then
    select coalesce(v_class_id, t.class_id), coalesce(v_student_id, t.student_id)
      into v_class_id, v_student_id
      from learning.assignment_targets t
     where t.assignment_id = v_assignment_id
     limit 1;
  end if;

  if v_academy_id is null and TG_TABLE_SCHEMA = 'ai' and TG_TABLE_NAME = 'messages' then
    select c.academy_id, c.student_id into v_academy_id, v_student_id
      from ai.conversations c
     where c.id = v_conversation_id;
  end if;

  if v_academy_id is null then
    if TG_OP = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  v_domain := case
    when TG_TABLE_SCHEMA = 'core' and TG_TABLE_NAME in ('students', 'people', 'academy_members', 'account_invitations') then 'students'
    when TG_TABLE_SCHEMA = 'core' and TG_TABLE_NAME = 'staff_members' then 'staff'
    when TG_TABLE_SCHEMA = 'core' and TG_TABLE_NAME in ('classes', 'class_students', 'class_books') then 'classes'
    when TG_TABLE_SCHEMA = 'lms' and TG_TABLE_NAME in ('invoices', 'invoice_lines', 'payments', 'expenses', 'instructor_payments', 'student_billing_contracts', 'billing_class_rules', 'settings') then 'accounting'
    when TG_TABLE_SCHEMA = 'lms' and TG_TABLE_NAME in ('classrooms', 'class_profiles', 'class_schedule_rules', 'lesson_occurrences', 'attendance_records') then 'classes'
    when TG_TABLE_SCHEMA = 'learning' and TG_TABLE_NAME in ('assignments', 'assignment_targets', 'assignment_items', 'assignment_files', 'book_assignments') then 'assignments'
    when TG_TABLE_SCHEMA = 'learning' and TG_TABLE_NAME in ('sessions', 'attempts', 'wrong_notes') then 'learning'
    when TG_TABLE_SCHEMA = 'learning' and TG_TABLE_NAME = 'reports' then 'reports'
    when TG_TABLE_SCHEMA = 'ai' then 'ai'
    when TG_TABLE_SCHEMA = 'content' and TG_TABLE_NAME = 'problem_reports' then 'reports'
    when TG_TABLE_SCHEMA = 'data' then 'data'
    else 'lms'
  end;

  perform realtime.send(
    jsonb_build_object(
      'domain', v_domain,
      'entity', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
      'id', v_row->>'id',
      'studentId', v_student_id,
      'classId', v_class_id,
      'academyId', v_academy_id,
      'changedAt', now(),
      'operation', TG_OP
    ),
    'lms-cache-invalidated',
    'academy:' || v_academy_id::text || ':lms-cache',
    true
  );

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  target record;
begin
  for target in
    select * from (values
      ('core', 'people'),
      ('core', 'students'),
      ('core', 'staff_members'),
      ('core', 'academy_members'),
      ('core', 'account_invitations'),
      ('core', 'classes'),
      ('core', 'class_students'),
      ('core', 'class_books'),
      ('lms', 'classrooms'),
      ('lms', 'class_profiles'),
      ('lms', 'class_schedule_rules'),
      ('lms', 'lesson_occurrences'),
      ('lms', 'attendance_records'),
      ('lms', 'student_billing_contracts'),
      ('lms', 'billing_class_rules'),
      ('lms', 'invoices'),
      ('lms', 'invoice_lines'),
      ('lms', 'payments'),
      ('lms', 'expenses'),
      ('lms', 'instructor_payments'),
      ('lms', 'settings'),
      ('learning', 'book_assignments'),
      ('learning', 'assignments'),
      ('learning', 'assignment_targets'),
      ('learning', 'assignment_items'),
      ('learning', 'assignment_files'),
      ('learning', 'sessions'),
      ('learning', 'attempts'),
      ('learning', 'wrong_notes'),
      ('learning', 'reports'),
      ('ai', 'conversations'),
      ('ai', 'messages'),
      ('content', 'problem_reports'),
      ('data', 'events')
    ) as targets(schema_name, table_name)
  loop
    if to_regclass(format('%I.%I', target.schema_name, target.table_name)) is not null then
      execute format('drop trigger if exists broadcast_lms_invalidation on %I.%I', target.schema_name, target.table_name);
      execute format(
        'create trigger broadcast_lms_invalidation after insert or update or delete on %I.%I for each row execute function core.broadcast_lms_invalidation()',
        target.schema_name,
        target.table_name
      );
    end if;
  end loop;
end;
$$;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    grant select on realtime.messages to authenticated;

    drop policy if exists lms_academy_cache_broadcasts_select on realtime.messages;
    create policy lms_academy_cache_broadcasts_select
      on realtime.messages
      for select
      to authenticated
      using (
        extension = 'broadcast'
        and topic ~ '^academy:[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12}:lms-cache$'
        and core.has_academy_role(
          split_part(topic, ':', 2)::uuid,
          array['owner','admin','staff','teacher','instructor','student','guardian']
        )
      );
  end if;
end;
$$;

revoke all on function core.uuid_or_null(text) from public, anon;
revoke all on function core.broadcast_lms_invalidation() from public, anon;
grant execute on function core.uuid_or_null(text) to authenticated, service_role;
grant execute on function core.broadcast_lms_invalidation() to service_role;
