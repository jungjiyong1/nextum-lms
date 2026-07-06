create index if not exists core_students_academy_created_idx
  on core.students (academy_id, created_at desc);

create index if not exists core_class_students_class_status_student_idx
  on core.class_students (class_id, status, student_id);

create index if not exists core_class_students_active_student_class_idx
  on core.class_students (student_id, class_id)
  where status = 'active';

create index if not exists lms_contracts_academy_status_student_idx
  on lms.student_billing_contracts (academy_id, status, student_id);

create index if not exists lms_billing_rules_academy_contract_idx
  on lms.billing_class_rules (academy_id, contract_id);

create index if not exists lms_attendance_academy_student_created_idx
  on lms.attendance_records (academy_id, student_id, created_at desc);

create index if not exists lms_invoices_academy_student_month_idx
  on lms.invoices (academy_id, student_id, service_month desc);

create index if not exists lms_payments_academy_student_date_idx
  on lms.payments (academy_id, student_id, payment_date desc);

create index if not exists lms_payments_academy_invoice_status_idx
  on lms.payments (academy_id, invoice_id, status)
  where invoice_id is not null;

create index if not exists learning_attempts_academy_student_created_idx
  on learning.attempts (academy_id, core_student_id, created_at desc);

create index if not exists learning_attempts_academy_student_problem_idx
  on learning.attempts (academy_id, core_student_id, problem_id);

create index if not exists learning_reports_academy_student_generated_idx
  on learning.reports (academy_id, core_student_id, generated_at desc);

create index if not exists ai_conversations_academy_student_updated_idx
  on ai.conversations (academy_id, student_id, updated_at desc);

create index if not exists content_problem_reports_academy_student_idx
  on content.problem_reports (academy_id, core_student_id);
