import { createClient } from '@supabase/supabase-js';
import { loadEnvFiles } from './_load-env.mjs';

loadEnvFiles();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const checks = [
  ['core', 'academies', ['id', 'name', 'status']],
  ['core', 'people', ['id', 'primary_academy_id', 'full_name', 'display_name', 'email', 'phone', 'parent_name', 'parent_phone']],
  ['core', 'user_accounts', ['id', 'auth_user_id', 'person_id', 'auth_email', 'login_id', 'status']],
  ['core', 'students', ['id', 'academy_id', 'person_id', 'status', 'school_type', 'grade']],
  ['core', 'staff_members', ['id', 'academy_id', 'person_id', 'role', 'status', 'hourly_rate']],
  ['core', 'academy_members', ['id', 'academy_id', 'person_id', 'user_account_id', 'role', 'active']],
  ['core', 'classes', ['id', 'academy_id', 'name', 'grade', 'active']],
  ['core', 'class_students', ['class_id', 'student_id', 'status', 'primary_class']],
  ['core', 'class_books', ['class_id', 'book_id', 'active', 'assigned_at']],
  ['core', 'account_invitations', ['id', 'academy_id', 'person_id', 'student_id', 'role', 'invite_code_hash', 'login_hint', 'expires_at', 'accepted_at']],
  ['core', 'user_security_settings', ['user_account_id', 'idle_timeout']],

  ['content', 'books', ['id', 'academy_id', 'book_key', 'title', 'subject', 'grade']],
  ['content', 'units', ['id', 'book_id', 'unit_key', 'part_name', 'name']],
  ['content', 'concepts', ['id', 'book_id', 'unit_id', 'name']],
  ['content', 'problem_types', ['id', 'book_id', 'unit_id', 'concept_id', 'name']],
  ['content', 'problems', ['id', 'book_id', 'unit_id', 'problem_type_id', 'page_printed', 'number', 'public_payload']],

  ['lms', 'classrooms', ['id', 'academy_id', 'name', 'capacity', 'color', 'active']],
  ['lms', 'class_profiles', ['class_id', 'academy_id', 'default_instructor_staff_id', 'default_classroom_id', 'capacity', 'color', 'status']],
  ['lms', 'class_schedule_rules', ['id', 'academy_id', 'class_id', 'day_of_week', 'start_time', 'end_time', 'start_date', 'end_date', 'active']],
  ['lms', 'lesson_occurrences', ['id', 'academy_id', 'class_id', 'rule_id', 'occurrence_date', 'start_time', 'end_time', 'status', 'cancel_reason']],
  ['lms', 'attendance_records', ['id', 'academy_id', 'occurrence_id', 'student_id', 'status', 'attended_minutes', 'billable_minutes', 'notes']],
  ['lms', 'student_billing_contracts', ['id', 'academy_id', 'student_id', 'billing_mode', 'base_monthly_fee', 'hourly_rate', 'status', 'effective_from', 'effective_to']],
  ['lms', 'billing_class_rules', ['id', 'academy_id', 'contract_id', 'class_id', 'rule_type', 'amount']],
  ['lms', 'invoices', ['id', 'academy_id', 'student_id', 'service_month', 'total_amount', 'paid_amount', 'status']],
  ['lms', 'invoice_lines', ['id', 'invoice_id', 'line_type', 'description', 'quantity', 'unit_amount', 'line_amount']],
  ['lms', 'payments', ['id', 'academy_id', 'invoice_id', 'student_id', 'payment_date', 'amount', 'status']],
  ['lms', 'expenses', ['id', 'academy_id', 'expense_date', 'category', 'amount', 'status']],
  ['lms', 'instructor_payments', ['id', 'academy_id', 'instructor_id', 'recipient_name', 'service_month', 'payment_date', 'gross_amount', 'net_amount', 'status']],
  ['lms', 'settings', ['academy_id', 'key', 'value']],

  ['learning', 'sessions', ['id', 'academy_id', 'core_student_id', 'book_id', 'scope', 'scope_label', 'context', 'started_at']],
  ['learning', 'attempts', ['id', 'academy_id', 'session_id', 'core_student_id', 'problem_id', 'correct', 'attempt_no', 'created_at']],
  ['learning', 'wrong_notes', ['academy_id', 'core_student_id', 'problem_id', 'status']],
  ['learning', 'reports', ['id', 'academy_id', 'core_student_id', 'report_type', 'generated_at']],

  ['ai', 'conversations', ['id', 'academy_id', 'student_id', 'core_student_id', 'title', 'created_at']],
  ['ai', 'messages', ['id', 'conversation_id', 'role', 'content', 'created_at']],
  ['data', 'events', ['id', 'academy_id', 'student_id', 'class_id', 'event_type', 'occurred_at']],

  ['reporting', 'v_student_type_weakness', ['academy_id', 'student_id', 'student_name', 'class_id', 'type_name', 'sample_count', 'correct_count', 'score', 'status', 'last_attempted_at']],
  ['reporting', 'v_class_learning_summary', ['academy_id', 'class_id', 'class_name', 'active_students', 'students_with_risk', 'weak_type_count', 'avg_type_score', 'last_learning_at']],
].map(([schema, table, columns]) => ({ schema, table, columns }));

function formatError(error) {
  const parts = [];
  if (error.code) parts.push(error.code);
  if (error.message) parts.push(error.message);
  if (error.hint) parts.push(`hint: ${error.hint}`);
  return parts.join(' | ') || 'Unknown error';
}

async function runCheck({ schema, table, columns }) {
  const { error } = await supabase
    .schema(schema)
    .from(table)
    .select(columns.join(','))
    .limit(1);

  return {
    schema,
    table,
    ok: !error,
    error,
  };
}

const results = [];
for (const check of checks) {
  results.push(await runCheck(check));
}

const failures = results.filter((result) => !result.ok);
for (const result of results) {
  const name = `${result.schema}.${result.table}`;
  if (result.ok) {
    console.log(`OK   ${name}`);
  } else {
    console.log(`FAIL ${name} :: ${formatError(result.error)}`);
  }
}

console.log('');
console.log(`Checked ${results.length} LMS database objects against the clean baseline contract.`);

if (failures.length > 0) {
  console.error(`${failures.length} object(s) failed. Apply or repair the LMS clean baseline before using the authenticated LMS app.`);
  process.exit(1);
}

console.log('LMS database health check passed.');
