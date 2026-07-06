import { jsonCsrfHeaders } from '@/lib/lms/csrf-client';
import type {
  AccountingOperationsOverview,
  AdminCsvExport,
  AdminExportOptions,
  AdminExportType,
  AdminResetTarget,
  ClassOperationsDetail,
  ClassOperationsOverview,
  CreateBookInput,
  CreateClassInput,
  CreateClassroomInput,
  CreateExpenseInput,
  CreateInstructorPaymentInput,
  CreateScheduleRuleInput,
  CreateStaffInput,
  CreateStudentInput,
  DashboardData,
  RecordAttendanceInput,
  RecordPaymentInput,
  StaffSummary,
  StudentDetail,
  StudentHardDeletePreview,
  StudentMutationResult,
  StudentOperationsOverview,
  UpdateBookInput,
  UpdateClassInput,
  UpdateClassroomInput,
  UpdateLessonOccurrenceInput,
  UpdateScheduleRuleInput,
  UpdateStaffInput,
  UpdateStudentInput,
} from './types';

async function postLmsMutation<T = undefined>(path: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: jsonCsrfHeaders(),
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null) as { success?: boolean; error?: string } & Record<string, unknown> | null;
  if (!response.ok || !result?.success) {
    throw new Error(result?.error || '요청 처리에 실패했습니다.');
  }
  return result as T;
}

async function getLmsJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const result = await response.json().catch(() => null) as { success?: boolean; error?: string; data?: T } | null;
  if (!response.ok || !result?.success) {
    throw new Error(result?.error || '요청 처리에 실패했습니다.');
  }
  return result.data as T;
}

function filenameFromDisposition(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1].trim());
  }

  const quotedMatch = disposition.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) return quotedMatch[1].trim();

  const plainMatch = disposition.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() || fallback;
}

async function postLmsCsvExport(path: string, payload: Record<string, unknown>): Promise<AdminCsvExport> {
  const response = await fetch(path, {
    method: 'POST',
    headers: jsonCsrfHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(result?.error || 'CSV 내보내기에 실패했습니다.');
  }

  return {
    filename: filenameFromDisposition(response.headers.get('Content-Disposition'), 'nextum-lms-export.csv'),
    csv: await response.text(),
  };
}

export async function getAcademyName(academyId: string): Promise<string | null> {
  const params = new URLSearchParams({ academyId });
  return getLmsJson<string | null>(`/api/lms/academy?${params.toString()}`);
}

export async function getDashboardData(academyId: string, serviceMonth: string): Promise<DashboardData> {
  const params = new URLSearchParams({ academyId, serviceMonth });
  return getLmsJson<DashboardData>(`/api/lms/dashboard?${params.toString()}`);
}

export async function createClass(academyId: string, input: CreateClassInput): Promise<void> {
  await postLmsMutation('/api/lms/classes', { academyId, input });
}

export async function updateClass(academyId: string, classId: string, input: UpdateClassInput): Promise<void> {
  await postLmsMutation('/api/lms/classes', { academyId, classId, input });
}

export async function loadClassOperationsOverview(
  academyId: string,
  startDate: string,
  endDate: string,
): Promise<ClassOperationsOverview> {
  const params = new URLSearchParams({ academyId, startDate, endDate });
  return getLmsJson<ClassOperationsOverview>(`/api/lms/classes/overview?${params.toString()}`);
}

export async function loadClassOperationsDetail(
  academyId: string,
  classId: string,
): Promise<ClassOperationsDetail> {
  const params = new URLSearchParams({ academyId, classId });
  return getLmsJson<ClassOperationsDetail>(`/api/lms/classes/detail?${params.toString()}`);
}

export async function createScheduleRule(academyId: string, input: CreateScheduleRuleInput): Promise<void> {
  await postLmsMutation('/api/lms/schedule-rules', { academyId, input });
}

export async function updateScheduleRule(academyId: string, ruleId: string, input: UpdateScheduleRuleInput): Promise<void> {
  await postLmsMutation('/api/lms/schedule-rules', { academyId, ruleId, input });
}

export async function updateLessonOccurrence(academyId: string, input: UpdateLessonOccurrenceInput): Promise<void> {
  await postLmsMutation('/api/lms/lesson-occurrences', { academyId, input });
}

export async function createStudent(academyId: string, input: CreateStudentInput): Promise<void> {
  await postLmsMutation('/api/lms/students', { academyId, input });
}

export async function updateStudent(academyId: string, studentId: string, input: UpdateStudentInput): Promise<void> {
  await postLmsMutation('/api/lms/students', { academyId, studentId, input });
}

export async function loadStudentOperationsOverview(academyId: string): Promise<StudentOperationsOverview> {
  const params = new URLSearchParams({ academyId });
  return getLmsJson<StudentOperationsOverview>(`/api/lms/students?${params.toString()}`);
}

export async function loadStudentDetail(academyId: string, studentId: string): Promise<StudentDetail> {
  const params = new URLSearchParams({ academyId, studentId });
  return getLmsJson<StudentDetail>(`/api/lms/students/detail?${params.toString()}`);
}

export async function archiveStudent(academyId: string, studentId: string): Promise<StudentMutationResult> {
  const result = await postLmsMutation<{ data?: StudentMutationResult }>('/api/lms/students/archive', { academyId, studentId });
  if (!result.data) throw new Error('학생 보관 처리 결과를 확인할 수 없습니다.');
  return result.data;
}

export async function previewHardDeleteStudent(academyId: string, studentId: string): Promise<StudentHardDeletePreview> {
  const result = await postLmsMutation<{ data?: StudentHardDeletePreview }>('/api/lms/students/hard-delete-preview', { academyId, studentId });
  if (!result.data) throw new Error('완전삭제 가능 여부를 확인할 수 없습니다.');
  return result.data;
}

export async function hardDeleteStudent(academyId: string, studentId: string, confirmName: string): Promise<StudentMutationResult> {
  const result = await postLmsMutation<{ data?: StudentMutationResult }>('/api/lms/students/hard-delete', { academyId, studentId, confirmName });
  if (!result.data) throw new Error('완전삭제 결과를 확인할 수 없습니다.');
  return result.data;
}

export async function listStaff(academyId: string): Promise<StaffSummary[]> {
  const params = new URLSearchParams({ academyId });
  return getLmsJson<StaffSummary[]>(`/api/lms/staff?${params.toString()}`);
}

export async function createStaff(academyId: string, input: CreateStaffInput): Promise<void> {
  await postLmsMutation('/api/lms/staff', { academyId, input });
}

export async function updateStaff(academyId: string, staffId: string, input: UpdateStaffInput): Promise<void> {
  await postLmsMutation('/api/lms/staff', { academyId, staffId, input });
}

export async function createBook(academyId: string, input: CreateBookInput): Promise<void> {
  await postLmsMutation('/api/lms/books', { academyId, input });
}

export async function updateBook(academyId: string, bookId: string, input: UpdateBookInput): Promise<void> {
  await postLmsMutation('/api/lms/books', { academyId, bookId, input });
}

export async function setClassBook(academyId: string, classId: string, bookId: string, active: boolean): Promise<void> {
  if (!classId || !bookId) throw new Error('반과 교재를 선택하세요.');
  await postLmsMutation('/api/lms/class-books', { academyId, classId, bookId, active });
}

export async function createClassroom(academyId: string, input: CreateClassroomInput): Promise<void> {
  await postLmsMutation('/api/lms/classrooms', { academyId, input });
}

export async function updateClassroom(academyId: string, classroomId: string, input: UpdateClassroomInput): Promise<void> {
  await postLmsMutation('/api/lms/classrooms', { academyId, classroomId, input });
}

export async function recordAttendance(academyId: string, input: RecordAttendanceInput): Promise<void> {
  await postLmsMutation('/api/lms/attendance', { academyId, input });
}

export async function generateMonthlyInvoices(academyId: string, serviceMonth: string): Promise<void> {
  await postLmsMutation('/api/lms/billing/generate', { academyId, serviceMonth });
}

export async function recordPayment(academyId: string, input: RecordPaymentInput): Promise<void> {
  await postLmsMutation('/api/lms/payments', { academyId, input });
}

export async function createExpense(academyId: string, input: CreateExpenseInput): Promise<void> {
  await postLmsMutation('/api/lms/expenses', { academyId, input });
}

export async function createInstructorPayment(academyId: string, input: CreateInstructorPaymentInput): Promise<void> {
  await postLmsMutation('/api/lms/payroll', { academyId, input });
}

export async function loadAccountingOperationsOverview(
  academyId: string,
  serviceMonth: string,
): Promise<AccountingOperationsOverview> {
  const params = new URLSearchParams({ academyId, serviceMonth });
  return getLmsJson<AccountingOperationsOverview>(`/api/lms/accounting?${params.toString()}`);
}

export async function updateTaxSettings(academyId: string, settings: Record<string, unknown>): Promise<void> {
  await postLmsMutation('/api/lms/admin/tax-settings', { academyId, settings });
}

export async function exportAdminCsv(
  academyId: string,
  type: AdminExportType,
  options: AdminExportOptions,
): Promise<AdminCsvExport> {
  return postLmsCsvExport('/api/lms/admin/export', { academyId, type, options });
}

export async function prepareAdminReset(
  academyId: string,
  target: AdminResetTarget,
  confirmText: string,
): Promise<{ confirmToken: string; expiresAt: string }> {
  const result = await postLmsMutation<{ confirmToken?: unknown; expiresAt?: unknown }>(
    '/api/lms/admin/reset/confirm',
    { academyId, target, confirmText },
  );
  if (typeof result.confirmToken !== 'string' || typeof result.expiresAt !== 'string') {
    throw new Error('초기화 확인 토큰을 발급하지 못했습니다.');
  }
  return {
    confirmToken: result.confirmToken,
    expiresAt: result.expiresAt,
  };
}

export async function resetAdminData(
  academyId: string,
  target: AdminResetTarget,
  confirmToken: string,
): Promise<void> {
  await postLmsMutation('/api/lms/admin/reset', { academyId, target, confirmToken });
}
