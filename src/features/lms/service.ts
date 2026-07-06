import { contentDb, coreDb, lmsDb, reportingDb } from '@/core/supabaseClient';
import { jsonCsrfHeaders } from '@/lib/lms/csrf-client';
import { calculateInvoiceDraft } from './billing';
import { COMPLETED_PAYMENT_STATUS } from './status';
import type {
  AdminCsvExport,
  AdminExportOptions,
  AdminExportType,
  AdminResetTarget,
  AttendanceRow,
  AccountingOperationsOverview,
  BillingClassRuleType,
  BillingMode,
  BillingRow,
  BookSummary,
  ClassBookSummary,
  ClassOperationsDetail,
  ClassOperationsOverview,
  ClassStudentSummary,
  ClassSummary,
  ClassroomSummary,
  CreateBookInput,
  CreateClassInput,
  CreateClassroomInput,
  CreateExpenseInput,
  CreateInstructorPaymentInput,
  CreateScheduleRuleInput,
  CreateStaffInput,
  CreateStudentInput,
  DashboardData,
  ExpenseRow,
  InstructorPaymentRow,
  PaymentRow,
  RecordAttendanceInput,
  RecordPaymentInput,
  ScheduleItem,
  ScheduleRuleSummary,
  StaffSummary,
  StudentOperationsOverview,
  StudentInvitationResult,
  StudentSummary,
  UpdateClassInput,
  UpdateBookInput,
  UpdateLessonOccurrenceInput,
  UpdateScheduleRuleInput,
  UpdateClassroomInput,
  UpdateStaffInput,
  UpdateStudentInput,
  WeakTypeRow,
} from './types';

type Row = Record<string, any>;

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function dateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function mondayFirstDay(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function weeksBetween(start: Date, target: Date): number {
  const ms = target.getTime() - start.getTime();
  return Math.floor(ms / (7 * 24 * 60 * 60 * 1000));
}

function normalizeTime(value: string | null | undefined): string {
  return (value || '').slice(0, 5);
}

function monthRange(serviceMonth: string): { start: string; end: string } {
  const [year, month] = serviceMonth.split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) {
    throw new Error('청구 월은 YYYY-MM 형식이어야 합니다.');
  }
  return {
    start: `${serviceMonth}-01`,
    end: dateString(new Date(year, month, 0)),
  };
}

function isEffective(row: Row, startDate: string, endDate: string): boolean {
  const from = String(row.effective_from || startDate);
  const to = row.effective_to ? String(row.effective_to) : null;
  return from <= endDate && (!to || to >= startDate);
}

async function fetchPeople(personIds: string[]): Promise<Map<string, Row>> {
  const ids = [...new Set(personIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const { data, error } = await coreDb
    .from('people')
    .select('id,full_name,display_name,email,phone,parent_name,parent_phone')
    .in('id', ids);

  if (error) throw new Error(error.message);
  return new Map((data || []).map((person: Row) => [person.id, person]));
}

async function fetchClassNames(classIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(classIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const { data, error } = await coreDb.from('classes').select('id,name').in('id', ids);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((row: Row) => [row.id, row.name]));
}

async function fetchStaffPeople(staffRows: Row[]): Promise<Map<string, string>> {
  const people = await fetchPeople(staffRows.map((row) => row.person_id));
  const names = new Map<string, string>();
  for (const staff of staffRows) {
    const person = people.get(staff.person_id);
    names.set(staff.id, person?.display_name || person?.full_name || '이름 없음');
  }
  return names;
}

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
    throw new Error(result?.error || '?붿껌 泥섎━???ㅽ뙣?덉뒿?덈떎.');
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

export async function listStaff(academyId: string): Promise<StaffSummary[]> {
  const params = new URLSearchParams({ academyId });
  return getLmsJson<StaffSummary[]>(`/api/lms/staff?${params.toString()}`);
}

export async function listClassSummaries(academyId: string): Promise<ClassSummary[]> {
  const { data: classesData, error: classesError } = await coreDb
    .from('classes')
    .select('id,name,grade,active')
    .eq('academy_id', academyId)
    .order('name');

  if (classesError) throw new Error(classesError.message);
  const classes = (classesData || []) as Row[];
  if (classes.length === 0) return [];

  const classIds = classes.map((row) => row.id);
  const [
    { data: profilesData, error: profilesError },
    { data: classStudentsData, error: classStudentsError },
    { data: learningData, error: learningError },
    { data: coursesData, error: coursesError },
    { data: classroomsData, error: classroomsError },
    { data: staffData, error: staffError },
  ] = await Promise.all([
    lmsDb.from('class_profiles').select('*').eq('academy_id', academyId).in('class_id', classIds),
    coreDb.from('class_students').select('class_id,student_id,status').in('class_id', classIds),
    reportingDb.from('v_class_learning_summary').select('*').eq('academy_id', academyId).in('class_id', classIds),
    lmsDb.from('courses').select('id,title').eq('academy_id', academyId),
    lmsDb.from('classrooms').select('id,name').eq('academy_id', academyId),
    coreDb.from('staff_members').select('id,person_id').eq('academy_id', academyId),
  ]);

  for (const error of [profilesError, classStudentsError, learningError, coursesError, classroomsError, staffError]) {
    if (error) throw new Error(error.message);
  }

  const profiles = new Map((profilesData || []).map((row: Row) => [row.class_id, row]));
  const courses = new Map((coursesData || []).map((row: Row) => [row.id, row.title]));
  const classrooms = new Map((classroomsData || []).map((row: Row) => [row.id, row.name]));
  const staffNames = await fetchStaffPeople((staffData || []) as Row[]);
  const learning = new Map((learningData || []).map((row: Row) => [row.class_id, row]));
  const studentCounts = new Map<string, number>();

  for (const enrollment of classStudentsData || []) {
    if (enrollment.status !== 'active') continue;
    studentCounts.set(enrollment.class_id, (studentCounts.get(enrollment.class_id) || 0) + 1);
  }

  return classes.map((row) => {
    const profile = profiles.get(row.id);
    const summary = learning.get(row.id);
    return {
      id: row.id,
      name: row.name,
      grade: row.grade ?? null,
      active: row.active,
      status: profile?.status || (row.active ? 'active' : 'inactive'),
      color: profile?.color ?? null,
      capacity: profile?.capacity ?? null,
      defaultInstructorId: profile?.default_instructor_staff_id ?? null,
      defaultClassroomId: profile?.default_classroom_id ?? null,
      courseTitle: profile?.course_id ? courses.get(profile.course_id) ?? null : null,
      instructorName: profile?.default_instructor_staff_id ? staffNames.get(profile.default_instructor_staff_id) ?? null : null,
      classroomName: profile?.default_classroom_id ? classrooms.get(profile.default_classroom_id) ?? null : null,
      studentCount: studentCounts.get(row.id) || 0,
      weakTypeCount: toNumber(summary?.weak_type_count),
      avgTypeScore: summary?.avg_type_score === null || summary?.avg_type_score === undefined ? null : Number(summary.avg_type_score),
      lastLearningAt: summary?.last_learning_at ?? null,
    };
  });
}

export async function createClass(academyId: string, input: CreateClassInput): Promise<void> {
  await postLmsMutation('/api/lms/classes', { academyId, input });
}

export async function updateClass(academyId: string, classId: string, input: UpdateClassInput): Promise<void> {
  await postLmsMutation('/api/lms/classes', { academyId, classId, input });
}

export async function listStudents(academyId: string): Promise<StudentSummary[]> {
  const { data: studentsData, error: studentsError } = await coreDb
    .from('students')
    .select('id,person_id,status,school_type,grade')
    .eq('academy_id', academyId)
    .order('created_at', { ascending: false });

  if (studentsError) throw new Error(studentsError.message);
  const students = (studentsData || []) as Row[];
  if (students.length === 0) return [];

  const studentIds = students.map((row) => row.id);
  const [{ data: classRows, error: classError }, { data: contracts, error: contractsError }] = await Promise.all([
    coreDb.from('class_students').select('class_id,student_id,status,classes(id,name)').in('student_id', studentIds),
    lmsDb.from('student_billing_contracts').select('*').eq('academy_id', academyId).in('student_id', studentIds).eq('status', 'active'),
  ]);

  if (classError) throw new Error(classError.message);
  if (contractsError) throw new Error(contractsError.message);

  const people = await fetchPeople(students.map((row) => row.person_id));
  const contractMap = new Map((contracts || []).map((row: Row) => [row.student_id, row]));
  const contractIds = (contracts || []).map((row: Row) => row.id);
  const rulesByContract = new Map<string, Row[]>();
  if (contractIds.length > 0) {
    const { data: rules, error: rulesError } = await lmsDb
      .from('billing_class_rules')
      .select('contract_id,class_id,rule_type,amount')
      .eq('academy_id', academyId)
      .in('contract_id', contractIds);
    if (rulesError) throw new Error(rulesError.message);
    for (const rule of rules || []) {
      rulesByContract.set(rule.contract_id, [...(rulesByContract.get(rule.contract_id) || []), rule]);
    }
  }
  const classNames = new Map<string, string[]>();
  const classIdsByStudent = new Map<string, string[]>();

  for (const row of classRows || []) {
    if (row.status !== 'active') continue;
    const cls = Array.isArray(row.classes) ? row.classes[0] : row.classes;
    const names = classNames.get(row.student_id) || [];
    if (cls?.name) names.push(cls.name);
    classNames.set(row.student_id, names);
    classIdsByStudent.set(row.student_id, [...(classIdsByStudent.get(row.student_id) || []), row.class_id]);
  }

  return students.map((row) => {
    const person = people.get(row.person_id);
    const contract = contractMap.get(row.id);
    const extraClassFee = (rulesByContract.get(contract?.id) || []).find((rule) => rule.rule_type === 'extra_flat')?.amount;
    return {
      id: row.id,
      personId: row.person_id,
      name: person?.display_name || person?.full_name || '이름 없음',
      phone: person?.phone ?? null,
      parentName: person?.parent_name ?? null,
      parentPhone: person?.parent_phone ?? null,
      schoolType: row.school_type ?? null,
      grade: row.grade ?? null,
      status: row.status,
      classIds: classIdsByStudent.get(row.id) || [],
      classNames: classNames.get(row.id) || [],
      billingMode: (contract?.billing_mode as BillingMode | undefined) ?? null,
      baseMonthlyFee: toNumber(contract?.base_monthly_fee),
      hourlyRate: contract?.hourly_rate === null || contract?.hourly_rate === undefined ? null : Number(contract.hourly_rate),
      extraClassFee: toNumber(extraClassFee),
    };
  });
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

export async function createStudentInvitation(academyId: string, studentId: string): Promise<StudentInvitationResult> {
  const result = await postLmsMutation<{ invite: StudentInvitationResult }>('/api/lms/invitations/issue', { academyId, studentId });
  return result.invite;
}

export async function createStaff(academyId: string, input: CreateStaffInput): Promise<void> {
  await postLmsMutation('/api/lms/staff', { academyId, input });
}

export async function updateStaff(academyId: string, staffId: string, input: UpdateStaffInput): Promise<void> {
  await postLmsMutation('/api/lms/staff', { academyId, staffId, input });
}

export async function listSchedule(academyId: string, startDate: string, endDate: string): Promise<ScheduleItem[]> {
  const [
    { data: classesData, error: classesError },
    { data: profilesData, error: profilesError },
    { data: rulesData, error: rulesError },
    { data: occurrencesData, error: occurrencesError },
    { data: classroomsData, error: classroomsError },
    { data: staffData, error: staffError },
  ] = await Promise.all([
    coreDb.from('classes').select('id,name').eq('academy_id', academyId),
    lmsDb.from('class_profiles').select('class_id,default_instructor_staff_id,default_classroom_id').eq('academy_id', academyId),
    lmsDb.from('class_schedule_rules').select('*').eq('academy_id', academyId).eq('active', true),
    lmsDb.from('lesson_occurrences').select('*').eq('academy_id', academyId).gte('occurrence_date', startDate).lte('occurrence_date', endDate),
    lmsDb.from('classrooms').select('id,name').eq('academy_id', academyId),
    coreDb.from('staff_members').select('id,person_id').eq('academy_id', academyId),
  ]);

  for (const error of [classesError, profilesError, rulesError, occurrencesError, classroomsError, staffError]) {
    if (error) throw new Error(error.message);
  }

  const classes = new Map((classesData || []).map((row: Row) => [row.id, row.name]));
  const profiles = new Map((profilesData || []).map((row: Row) => [row.class_id, row]));
  const classrooms = new Map((classroomsData || []).map((row: Row) => [row.id, row.name]));
  const staffNames = await fetchStaffPeople((staffData || []) as Row[]);
  const items: ScheduleItem[] = [];
  const actualKeys = new Set<string>();

  for (const row of occurrencesData || []) {
    const start = normalizeTime(row.start_time);
    actualKeys.add(`${row.class_id}:${row.rule_id || 'none'}:${row.occurrence_date}:${start}`);
    const profile = profiles.get(row.class_id);
    const instructorId = row.substitute_staff_id || row.instructor_staff_id || profile?.default_instructor_staff_id;
    const classroomId = row.classroom_id || profile?.default_classroom_id;
    items.push({
      id: row.id,
      actualId: row.id,
      virtual: false,
      classId: row.class_id,
      className: classes.get(row.class_id) || '이름 없는 반',
      ruleId: row.rule_id ?? null,
      date: row.occurrence_date,
      startTime: start,
      endTime: normalizeTime(row.end_time),
      status: row.status as ScheduleItem['status'],
      classroomName: classroomId ? classrooms.get(classroomId) ?? null : null,
      instructorId: instructorId ?? null,
      instructorName: instructorId ? staffNames.get(instructorId) ?? null : null,
      cancelReason: row.cancel_reason ?? null,
    });
  }

  const rangeStart = parseDate(startDate);
  const rangeEnd = parseDate(endDate);
  for (const rule of rulesData || []) {
    const ruleStart = parseDate(rule.start_date);
    const ruleEnd = rule.end_date ? parseDate(rule.end_date) : null;
    let current = rangeStart > ruleStart ? new Date(rangeStart) : new Date(ruleStart);

    while (current <= rangeEnd) {
      if (ruleEnd && current > ruleEnd) break;
      const day = mondayFirstDay(current);
      const weekOffset = weeksBetween(ruleStart, current);
      const date = dateString(current);
      const start = normalizeTime(rule.start_time);
      const key = `${rule.class_id}:${rule.id}:${date}:${start}`;
      if (day === rule.day_of_week && weekOffset >= 0 && weekOffset % rule.interval_weeks === 0 && !actualKeys.has(key)) {
        const profile = profiles.get(rule.class_id);
        const classroomId = rule.classroom_id || profile?.default_classroom_id;
        const instructorId = rule.instructor_staff_id || profile?.default_instructor_staff_id;
        items.push({
          id: `virtual:${rule.id}:${date}`,
          actualId: null,
          virtual: true,
          classId: rule.class_id,
          className: classes.get(rule.class_id) || '이름 없는 반',
          ruleId: rule.id,
          date,
          startTime: start,
          endTime: normalizeTime(rule.end_time),
          status: 'scheduled',
          classroomName: classroomId ? classrooms.get(classroomId) ?? null : null,
          instructorId: instructorId ?? null,
          instructorName: instructorId ? staffNames.get(instructorId) ?? null : null,
          cancelReason: null,
        });
      }
      current = addDays(current, 1);
    }
  }

  return items.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

export async function listScheduleRules(academyId: string, classId?: string): Promise<ScheduleRuleSummary[]> {
  let query = lmsDb
    .from('class_schedule_rules')
    .select('*')
    .eq('academy_id', academyId)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true });

  if (classId) {
    query = query.eq('class_id', classId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data || []) as Row[];
  if (rows.length === 0) return [];

  const classIds = [...new Set(rows.map((row) => row.class_id).filter(Boolean))];
  const classroomIds = [...new Set(rows.map((row) => row.classroom_id).filter(Boolean))];
  const staffIds = [...new Set(rows.map((row) => row.instructor_staff_id).filter(Boolean))];

  const [classNames, classroomsResult, staffResult] = await Promise.all([
    fetchClassNames(classIds),
    classroomIds.length > 0
      ? lmsDb.from('classrooms').select('id,name').eq('academy_id', academyId).in('id', classroomIds)
      : Promise.resolve({ data: [], error: null }),
    staffIds.length > 0
      ? coreDb.from('staff_members').select('id,person_id').eq('academy_id', academyId).in('id', staffIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (classroomsResult.error) throw new Error(classroomsResult.error.message);
  if (staffResult.error) throw new Error(staffResult.error.message);

  const classroomMap = new Map(((classroomsResult.data || []) as Row[]).map((row) => [row.id, row.name]));
  const staffNames = await fetchStaffPeople((staffResult.data || []) as Row[]);

  return rows.map((row) => ({
    id: row.id,
    classId: row.class_id,
    className: classNames.get(row.class_id) || '이름 없는 반',
    dayOfWeek: Number(row.day_of_week),
    startTime: normalizeTime(row.start_time),
    endTime: normalizeTime(row.end_time),
    startDate: row.start_date,
    endDate: row.end_date ?? null,
    active: Boolean(row.active),
    classroomName: row.classroom_id ? classroomMap.get(row.classroom_id) ?? null : null,
    instructorId: row.instructor_staff_id ?? null,
    instructorName: row.instructor_staff_id ? staffNames.get(row.instructor_staff_id) ?? null : null,
  }));
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


export async function listClassStudents(academyId: string, classId: string): Promise<ClassStudentSummary[]> {
  if (!classId) return [];

  const { data: enrollments, error } = await coreDb
    .from('class_students')
    .select('student_id,status')
    .eq('class_id', classId);
  if (error) throw new Error(error.message);

  const studentIds = [...new Set((enrollments || []).map((row: Row) => row.student_id))];
  if (studentIds.length === 0) return [];

  const { data: students, error: studentsError } = await coreDb
    .from('students')
    .select('id,person_id,status')
    .eq('academy_id', academyId)
    .in('id', studentIds);
  if (studentsError) throw new Error(studentsError.message);

  const people = await fetchPeople((students || []).map((row: Row) => row.person_id));
  const enrollmentStatus = new Map((enrollments || []).map((row: Row) => [row.student_id, row.status]));

  return (students || []).map((row: Row) => {
    const person = people.get(row.person_id);
    return {
      id: row.id,
      personId: row.person_id,
      name: person?.display_name || person?.full_name || '이름 없음',
      status: enrollmentStatus.get(row.id) || row.status,
    };
  });
}

export async function listBooks(academyId: string): Promise<BookSummary[]> {
  const { data, error } = await contentDb
    .from('books')
    .select('id,book_key,title,subject,grade')
    .eq('academy_id', academyId)
    .order('title');

  if (error) throw new Error(error.message);
  return (data || []).map((row: Row) => ({
    id: row.id,
    bookKey: row.book_key,
    title: row.title,
    subject: row.subject ?? null,
    grade: row.grade ?? null,
  }));
}

export async function createBook(academyId: string, input: CreateBookInput): Promise<void> {
  await postLmsMutation('/api/lms/books', { academyId, input });
}

export async function updateBook(academyId: string, bookId: string, input: UpdateBookInput): Promise<void> {
  await postLmsMutation('/api/lms/books', { academyId, bookId, input });
}

export async function listClassrooms(academyId: string): Promise<ClassroomSummary[]> {
  const { data, error } = await lmsDb
    .from('classrooms')
    .select('id,name,capacity,color,active')
    .eq('academy_id', academyId)
    .order('name');
  if (error) throw new Error(error.message);

  return (data || []).map((row: Row) => ({
    id: row.id,
    name: row.name,
    capacity: row.capacity === null || row.capacity === undefined ? null : Number(row.capacity),
    color: row.color ?? null,
    active: Boolean(row.active),
  }));
}

export async function createClassroom(academyId: string, input: CreateClassroomInput): Promise<void> {
  await postLmsMutation('/api/lms/classrooms', { academyId, input });
}

export async function updateClassroom(academyId: string, classroomId: string, input: UpdateClassroomInput): Promise<void> {
  await postLmsMutation('/api/lms/classrooms', { academyId, classroomId, input });
}

export async function listClassBooks(classId: string): Promise<ClassBookSummary[]> {
  if (!classId) return [];

  const { data: assignments, error } = await coreDb
    .from('class_books')
    .select('book_id,assigned_at,active')
    .eq('class_id', classId)
    .eq('active', true)
    .order('assigned_at', { ascending: false });
  if (error) throw new Error(error.message);

  const bookIds = [...new Set((assignments || []).map((row: Row) => row.book_id))];
  if (bookIds.length === 0) return [];

  const { data: books, error: booksError } = await contentDb
    .from('books')
    .select('id,book_key,title,subject,grade')
    .in('id', bookIds);
  if (booksError) throw new Error(booksError.message);

  const bookMap = new Map((books || []).map((row: Row) => [row.id, row]));
  return (assignments || []).map((row: Row) => {
    const book = bookMap.get(row.book_id);
    return {
      id: row.book_id,
      bookKey: book?.book_key || '',
      title: book?.title || '이름 없는 교재',
      subject: book?.subject ?? null,
      grade: book?.grade ?? null,
      assignedAt: row.assigned_at,
      active: row.active,
    };
  });
}

export async function setClassBook(academyId: string, classId: string, bookId: string, active: boolean): Promise<void> {
  if (!classId || !bookId) throw new Error('반과 교재를 선택하세요.');
  await postLmsMutation('/api/lms/class-books', { academyId, classId, bookId, active });
}

export async function recordAttendance(academyId: string, input: RecordAttendanceInput): Promise<void> {
  await postLmsMutation('/api/lms/attendance', { academyId, input });
}

export async function listAttendance(academyId: string, startDate: string, endDate: string): Promise<AttendanceRow[]> {
  const { data: occurrences, error: occurrencesError } = await lmsDb
    .from('lesson_occurrences')
    .select('id,class_id,occurrence_date,start_time,end_time')
    .eq('academy_id', academyId)
    .gte('occurrence_date', startDate)
    .lte('occurrence_date', endDate);
  if (occurrencesError) throw new Error(occurrencesError.message);

  const occurrenceRows = (occurrences || []) as Row[];
  const occurrenceIds = occurrenceRows.map((row) => row.id);
  if (occurrenceIds.length === 0) return [];

  const { data: attendance, error: attendanceError } = await lmsDb
    .from('attendance_records')
    .select('id,occurrence_id,student_id,status,attended_minutes,billable_minutes,notes')
    .eq('academy_id', academyId)
    .in('occurrence_id', occurrenceIds)
    .order('created_at', { ascending: false });
  if (attendanceError) throw new Error(attendanceError.message);

  const occurrenceMap = new Map(occurrenceRows.map((row) => [row.id, row]));
  const studentIds = [...new Set((attendance || []).map((row: Row) => row.student_id))];
  const classIds = [...new Set(occurrenceRows.map((row) => row.class_id))];

  const [{ data: students, error: studentsError }, classNames] = await Promise.all([
    coreDb.from('students').select('id,person_id').eq('academy_id', academyId).in('id', studentIds),
    fetchClassNames(classIds),
  ]);
  if (studentsError) throw new Error(studentsError.message);

  const studentMap = new Map((students || []).map((row: Row) => [row.id, row]));
  const people = await fetchPeople((students || []).map((row: Row) => row.person_id));

  return (attendance || []).map((row: Row) => {
    const occurrence = occurrenceMap.get(row.occurrence_id);
    const student = studentMap.get(row.student_id);
    const person = student ? people.get(student.person_id) : null;
    return {
      id: row.id,
      occurrenceId: row.occurrence_id,
      studentId: row.student_id,
      studentName: person?.display_name || person?.full_name || '이름 없음',
      classId: occurrence?.class_id || '',
      className: occurrence?.class_id ? classNames.get(occurrence.class_id) || '이름 없는 반' : '이름 없는 반',
      date: occurrence?.occurrence_date || '',
      startTime: normalizeTime(occurrence?.start_time),
      endTime: normalizeTime(occurrence?.end_time),
      status: row.status,
      attendedMinutes: row.attended_minutes ?? null,
      billableMinutes: row.billable_minutes ?? null,
      notes: row.notes ?? null,
    };
  });
}

export async function listWeakTypes(academyId: string, limit = 20): Promise<WeakTypeRow[]> {
  const { data, error } = await reportingDb
    .from('v_student_type_weakness')
    .select('*')
    .eq('academy_id', academyId)
    .in('status', ['weak', 'watch'])
    .order('status', { ascending: true })
    .order('last_attempted_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data || []).map((row: Row) => ({
    studentId: row.student_id,
    studentName: row.student_name || '이름 없음',
    classId: row.class_id ?? null,
    typeName: row.type_name || '유형 없음',
    sampleCount: toNumber(row.sample_count),
    correctCount: toNumber(row.correct_count),
    score: row.score === null || row.score === undefined ? null : Number(row.score),
    status: row.status,
    lastAttemptedAt: row.last_attempted_at ?? null,
  }));
}

async function buildBillingDrafts(academyId: string, serviceMonth: string) {
  const range = monthRange(serviceMonth);
  const students = await listStudents(academyId);
  const studentIds = students.map((student) => student.id);
  if (studentIds.length === 0) return [];

  const [
    { data: contractsData, error: contractsError },
    { data: rulesData, error: rulesError },
    { data: occurrencesData, error: occurrencesError },
  ] = await Promise.all([
    lmsDb.from('student_billing_contracts').select('*').eq('academy_id', academyId).eq('status', 'active').in('student_id', studentIds),
    lmsDb.from('billing_class_rules').select('*').eq('academy_id', academyId),
    lmsDb
      .from('lesson_occurrences')
      .select('id,class_id,occurrence_date')
      .eq('academy_id', academyId)
      .gte('occurrence_date', range.start)
      .lte('occurrence_date', range.end),
  ]);
  if (contractsError) throw new Error(contractsError.message);
  if (rulesError) throw new Error(rulesError.message);
  if (occurrencesError) throw new Error(occurrencesError.message);

  const contracts = ((contractsData || []) as Row[]).filter((row) => isEffective(row, range.start, range.end));
  const contractMap = new Map(contracts.map((row) => [row.student_id, row]));
  const contractIds = contracts.map((row) => row.id);
  const rules = ((rulesData || []) as Row[])
    .filter((row) => contractIds.includes(row.contract_id))
    .filter((row) => isEffective(row, range.start, range.end));
  const classIds = [...new Set([
    ...rules.map((row) => row.class_id),
    ...((occurrencesData || []) as Row[]).map((row) => row.class_id),
  ])];
  const classNames = await fetchClassNames(classIds);

  const occurrenceRows = (occurrencesData || []) as Row[];
  const occurrenceIds = occurrenceRows.map((row) => row.id);
  let attendanceRows: Row[] = [];
  if (occurrenceIds.length > 0) {
    const { data, error } = await lmsDb
      .from('attendance_records')
      .select('occurrence_id,student_id,status,billable_minutes')
      .eq('academy_id', academyId)
      .in('occurrence_id', occurrenceIds)
      .in('student_id', studentIds);
    if (error) throw new Error(error.message);
    attendanceRows = (data || []) as Row[];
  }

  const occurrenceMap = new Map(occurrenceRows.map((row) => [row.id, row]));
  const rulesByContract = new Map<string, Row[]>();
  for (const rule of rules) {
    rulesByContract.set(rule.contract_id, [...(rulesByContract.get(rule.contract_id) || []), rule]);
  }

  const attendanceByStudent = new Map<string, Row[]>();
  for (const attendance of attendanceRows) {
    attendanceByStudent.set(attendance.student_id, [...(attendanceByStudent.get(attendance.student_id) || []), attendance]);
  }

  return students.map((student) => {
    const contract = contractMap.get(student.id);
    if (!contract) return { student, contract: null, draft: null };

    const draft = calculateInvoiceDraft({
      contract: {
        studentId: student.id,
        billingMode: contract.billing_mode,
        baseMonthlyFee: toNumber(contract.base_monthly_fee),
        hourlyRate: contract.hourly_rate === null || contract.hourly_rate === undefined ? null : Number(contract.hourly_rate),
      },
      rules: (rulesByContract.get(contract.id) || []).map((rule) => ({
        classId: rule.class_id,
        className: classNames.get(rule.class_id) || null,
        ruleType: rule.rule_type as BillingClassRuleType,
        amount: toNumber(rule.amount),
      })),
      attendances: (attendanceByStudent.get(student.id) || []).map((attendance) => {
        const occurrence = occurrenceMap.get(attendance.occurrence_id);
        return {
          classId: occurrence?.class_id || '',
          className: occurrence?.class_id ? classNames.get(occurrence.class_id) || null : null,
          occurrenceId: attendance.occurrence_id,
          status: attendance.status,
          billableMinutes: attendance.billable_minutes ?? null,
        };
      }),
    });

    return { student, contract, draft };
  });
}

export async function listBilling(academyId: string, serviceMonth: string): Promise<BillingRow[]> {
  const [drafts, { data: invoicesData, error: invoicesError }] = await Promise.all([
    buildBillingDrafts(academyId, serviceMonth),
    lmsDb.from('invoices').select('id,student_id,total_amount,paid_amount,status').eq('academy_id', academyId).eq('service_month', serviceMonth),
  ]);
  if (invoicesError) throw new Error(invoicesError.message);

  const invoices = new Map((invoicesData || []).map((row: Row) => [row.student_id, row]));
  const invoiceIds = (invoicesData || []).map((row: Row) => row.id).filter(Boolean);
  const paidByInvoice = new Map<string, number>();
  if (invoiceIds.length > 0) {
    const { data: paymentsData, error: paymentsError } = await lmsDb
      .from('payments')
      .select('invoice_id,amount')
      .eq('academy_id', academyId)
      .eq('status', COMPLETED_PAYMENT_STATUS)
      .in('invoice_id', invoiceIds);
    if (paymentsError) throw new Error(paymentsError.message);
    for (const payment of paymentsData || []) {
      paidByInvoice.set(payment.invoice_id, (paidByInvoice.get(payment.invoice_id) || 0) + toNumber(payment.amount));
    }
  }

  return drafts.map(({ student, draft }) => {
    const invoice = invoices.get(student.id);
    const expectedAmount = draft?.totalAmount ?? 0;
    const actualPaidAmount = invoice?.id ? paidByInvoice.get(invoice.id) : undefined;
    return {
      studentId: student.id,
      studentName: student.name,
      billingMode: student.billingMode,
      expectedAmount,
      invoicedAmount: toNumber(invoice?.total_amount, expectedAmount),
      paidAmount: actualPaidAmount ?? toNumber(invoice?.paid_amount),
      status: invoice?.status || 'not_issued',
      invoiceId: invoice?.id ?? null,
    };
  });
}

export async function listPayments(academyId: string, startDate: string, endDate: string): Promise<PaymentRow[]> {
  const { data, error } = await lmsDb
    .from('payments')
    .select('id,invoice_id,student_id,payment_date,amount,payment_method,status,notes')
    .eq('academy_id', academyId)
    .gte('payment_date', startDate)
    .lte('payment_date', endDate)
    .order('payment_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const payments = (data || []) as Row[];
  if (payments.length === 0) return [];

  const { data: students, error: studentsError } = await coreDb
    .from('students')
    .select('id,person_id')
    .eq('academy_id', academyId)
    .in('id', [...new Set(payments.map((row) => row.student_id))]);
  if (studentsError) throw new Error(studentsError.message);

  const studentMap = new Map((students || []).map((row: Row) => [row.id, row]));
  const people = await fetchPeople((students || []).map((row: Row) => row.person_id));

  return payments.map((row) => {
    const student = studentMap.get(row.student_id);
    const person = student ? people.get(student.person_id) : null;
    return {
      id: row.id,
      invoiceId: row.invoice_id ?? null,
      studentId: row.student_id,
      studentName: person?.display_name || person?.full_name || '이름 없음',
      paymentDate: row.payment_date,
      amount: toNumber(row.amount),
      paymentMethod: row.payment_method ?? null,
      status: row.status,
      notes: row.notes ?? null,
    };
  });
}

export async function listExpenses(academyId: string, startDate: string, endDate: string): Promise<ExpenseRow[]> {
  const { data, error } = await lmsDb
    .from('expenses')
    .select('id,expense_date,category,amount,payment_method,recipient,description,tax_deductible,has_receipt,notes')
    .eq('academy_id', academyId)
    .gte('expense_date', startDate)
    .lte('expense_date', endDate)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  return (data || []).map((row: Row) => ({
    id: row.id,
    expenseDate: row.expense_date,
    category: row.category,
    amount: toNumber(row.amount),
    paymentMethod: row.payment_method ?? null,
    recipient: row.recipient ?? null,
    description: row.description ?? null,
    taxDeductible: Boolean(row.tax_deductible),
    hasReceipt: Boolean(row.has_receipt),
    notes: row.notes ?? null,
  }));
}

export async function listInstructorPayments(academyId: string, serviceMonth: string): Promise<InstructorPaymentRow[]> {
  const { data, error } = await lmsDb
    .from('instructor_payments')
    .select('id,instructor_id,recipient_name,service_month,payment_date,gross_amount,withholding_type,withholding_rate,withholding_tax,local_tax,net_amount,hours_worked,hourly_rate,payment_method,status,notes')
    .eq('academy_id', academyId)
    .eq('service_month', serviceMonth)
    .order('payment_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (data || []) as Row[];
  const staffIds = [...new Set(rows.map((row) => row.instructor_id).filter(Boolean))];
  const { data: staffRows, error: staffError } = staffIds.length > 0
    ? await coreDb.from('staff_members').select('id,person_id').eq('academy_id', academyId).in('id', staffIds)
    : { data: [], error: null };
  if (staffError) throw new Error(staffError.message);

  const staffMap = new Map((staffRows || []).map((row: Row) => [row.id, row]));
  const people = await fetchPeople((staffRows || []).map((row: Row) => row.person_id));

  return rows.map((row) => {
    const staff = row.instructor_id ? staffMap.get(row.instructor_id) : null;
    const person = staff ? people.get(staff.person_id) : null;
    return {
      id: row.id,
      instructorId: row.instructor_id ?? null,
      instructorName: person?.display_name || person?.full_name || null,
      recipientName: row.recipient_name ?? null,
      serviceMonth: row.service_month,
      paymentDate: row.payment_date,
      grossAmount: toNumber(row.gross_amount),
      withholdingType: row.withholding_type,
      withholdingRate: toNumber(row.withholding_rate),
      withholdingTax: toNumber(row.withholding_tax),
      localTax: toNumber(row.local_tax),
      netAmount: toNumber(row.net_amount),
      hoursWorked: row.hours_worked === null || row.hours_worked === undefined ? null : Number(row.hours_worked),
      hourlyRate: row.hourly_rate === null || row.hourly_rate === undefined ? null : Number(row.hourly_rate),
      paymentMethod: row.payment_method ?? null,
      status: row.status,
      notes: row.notes ?? null,
    };
  });
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

export async function getDashboardData(academyId: string, serviceMonth: string): Promise<DashboardData> {
  const params = new URLSearchParams({ academyId, serviceMonth });
  return getLmsJson<DashboardData>(`/api/lms/dashboard?${params.toString()}`);
}
