import { aiDb, contentDb, coreDb, lmsDb, reportingDb } from '@/core/supabaseClient';
import { calculateInvoiceDraft } from './billing';
import type {
  AttendanceRow,
  BillingClassRuleType,
  BillingMode,
  BillingRow,
  BookSummary,
  ClassBookSummary,
  ClassStudentSummary,
  ClassSummary,
  CreateClassInput,
  CreateScheduleRuleInput,
  CreateStaffInput,
  CreateStudentInput,
  DashboardData,
  RecordAttendanceInput,
  ScheduleItem,
  StaffSummary,
  StudentClassBillingInput,
  StudentInvitationResult,
  StudentSummary,
  WeakTypeRow,
} from './types';

type Row = Record<string, any>;

const STAFF_ROLES = ['owner', 'admin', 'staff', 'teacher', 'instructor'];

function requireData<T>(data: T | null, error: { message?: string } | null): T {
  if (error) throw new Error(error.message || 'Database request failed');
  if (data === null) throw new Error('Database returned no data');
  return data;
}

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

function minutesBetween(startTime: string, endTime: string): number {
  const [startHour, startMinute] = normalizeTime(startTime).split(':').map(Number);
  const [endHour, endMinute] = normalizeTime(endTime).split(':').map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  return Math.max(0, end - start);
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

function defaultBillingRules(input: CreateStudentInput): StudentClassBillingInput[] {
  const classIds = [...new Set(input.classIds || [])];
  if (input.classBillingRules && input.classBillingRules.length > 0) {
    return input.classBillingRules.filter((rule) => classIds.includes(rule.classId));
  }

  if (input.billingMode === 'usage_based') {
    return classIds.map((classId) => ({
      classId,
      ruleType: 'usage_based',
      amount: input.hourlyRate || 0,
    }));
  }

  return classIds.map((classId, index) => ({
    classId,
    ruleType: index === 0 || input.billingMode === 'manual' ? 'included' : 'extra_flat',
    amount: 0,
  }));
}

function randomInviteCode(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes)
    .map((byte) => byte.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 12)
    .toUpperCase();
  return `NX-${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(8, 12)}`;
}

async function sha256Hex(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(value.trim().toUpperCase()));
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function getAcademyName(academyId: string): Promise<string | null> {
  const { data, error } = await coreDb
    .from('academies')
    .select('name')
    .eq('id', academyId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.name ?? null;
}

export async function listStaff(academyId: string): Promise<StaffSummary[]> {
  const { data: staffRows, error } = await coreDb
    .from('staff_members')
    .select('id,person_id,role,status,hourly_rate')
    .eq('academy_id', academyId)
    .in('role', STAFF_ROLES)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  const staff = (staffRows || []) as Row[];
  const people = await fetchPeople(staff.map((row) => row.person_id));

  return staff.map((row) => {
    const person = people.get(row.person_id);
    return {
      id: row.id,
      personId: row.person_id,
      name: person?.display_name || person?.full_name || '이름 없음',
      phone: person?.phone ?? null,
      email: person?.email ?? null,
      role: row.role,
      status: row.status,
      hourlyRate: row.hourly_rate === null || row.hourly_rate === undefined ? null : Number(row.hourly_rate),
    };
  });
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
  const name = input.name.trim();
  if (!name) throw new Error('반 이름을 입력하세요.');

  const { data: created, error } = await coreDb
    .from('classes')
    .insert({
      academy_id: academyId,
      name,
      grade: input.grade || null,
      active: true,
    })
    .select('id')
    .single();

  const classRow = requireData(created, error);

  const { error: profileError } = await lmsDb.from('class_profiles').insert({
    academy_id: academyId,
    class_id: classRow.id,
    capacity: input.capacity ?? null,
    color: input.color || null,
    default_instructor_staff_id: input.defaultInstructorId || null,
    default_classroom_id: input.defaultClassroomId || null,
    status: 'active',
  });

  if (profileError) throw new Error(profileError.message);
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
  const classNames = new Map<string, string[]>();

  for (const row of classRows || []) {
    if (row.status !== 'active') continue;
    const cls = Array.isArray(row.classes) ? row.classes[0] : row.classes;
    const names = classNames.get(row.student_id) || [];
    if (cls?.name) names.push(cls.name);
    classNames.set(row.student_id, names);
  }

  return students.map((row) => {
    const person = people.get(row.person_id);
    const contract = contractMap.get(row.id);
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
      classNames: classNames.get(row.id) || [],
      billingMode: (contract?.billing_mode as BillingMode | undefined) ?? null,
      baseMonthlyFee: toNumber(contract?.base_monthly_fee),
      hourlyRate: contract?.hourly_rate === null || contract?.hourly_rate === undefined ? null : Number(contract.hourly_rate),
    };
  });
}

export async function createStudent(academyId: string, input: CreateStudentInput): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new Error('학생 이름을 입력하세요.');

  const classIds = [...new Set(input.classIds || [])];

  const { data: person, error: personError } = await coreDb
    .from('people')
    .insert({
      primary_academy_id: academyId,
      full_name: name,
      display_name: name,
      phone: input.phone || null,
      parent_name: input.parentName || null,
      parent_phone: input.parentPhone || null,
    })
    .select('id')
    .single();
  const createdPerson = requireData(person, personError);

  const { data: student, error: studentError } = await coreDb
    .from('students')
    .insert({
      academy_id: academyId,
      person_id: createdPerson.id,
      status: 'active',
      school_type: input.schoolType || null,
      grade: input.grade || null,
      enrollment_date: dateString(new Date()),
    })
    .select('id')
    .single();
  const createdStudent = requireData(student, studentError);

  const classRows = classIds.map((classId, index) => ({
    class_id: classId,
    student_id: createdStudent.id,
    status: 'active',
    primary_class: index === 0,
  }));
  if (classRows.length > 0) {
    const { error } = await coreDb.from('class_students').insert(classRows);
    if (error) throw new Error(error.message);
  }

  const { data: contract, error: contractError } = await lmsDb
    .from('student_billing_contracts')
    .insert({
      academy_id: academyId,
      student_id: createdStudent.id,
      billing_mode: input.billingMode,
      base_monthly_fee: input.baseMonthlyFee || 0,
      hourly_rate: input.hourlyRate ?? null,
      status: 'active',
    })
    .select('id')
    .single();
  const createdContract = requireData(contract, contractError);

  const billingRules = defaultBillingRules(input).map((rule) => ({
    academy_id: academyId,
    contract_id: createdContract.id,
    class_id: rule.classId,
    rule_type: rule.ruleType,
    amount: rule.amount || 0,
  }));

  if (billingRules.length > 0) {
    const { error } = await lmsDb.from('billing_class_rules').insert(billingRules);
    if (error) throw new Error(error.message);
  }
}

export async function createStudentInvitation(academyId: string, studentId: string): Promise<StudentInvitationResult> {
  if (!studentId) throw new Error('학생을 선택하세요.');

  const { data: student, error: studentError } = await coreDb
    .from('students')
    .select('id,person_id,status')
    .eq('academy_id', academyId)
    .eq('id', studentId)
    .single();
  const studentRow = requireData(student, studentError);

  const people = await fetchPeople([studentRow.person_id]);
  const person = people.get(studentRow.person_id);
  const code = randomInviteCode();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await coreDb.from('account_invitations').insert({
    academy_id: academyId,
    person_id: studentRow.person_id,
    student_id: studentRow.id,
    role: 'student',
    invite_code_hash: await sha256Hex(code),
    login_hint: person?.display_name || person?.full_name || null,
    expires_at: expiresAt,
  });

  if (error) throw new Error(error.message);

  return {
    code,
    expiresAt,
    loginHint: person?.display_name || person?.full_name || null,
  };
}

export async function createStaff(academyId: string, input: CreateStaffInput): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new Error('이름을 입력하세요.');

  const { data: person, error: personError } = await coreDb
    .from('people')
    .insert({
      primary_academy_id: academyId,
      full_name: name,
      display_name: name,
      phone: input.phone || null,
      email: input.email || null,
    })
    .select('id')
    .single();
  const createdPerson = requireData(person, personError);

  const { error: staffError } = await coreDb.from('staff_members').insert({
    academy_id: academyId,
    person_id: createdPerson.id,
    role: input.role,
    status: 'active',
    hourly_rate: input.hourlyRate ?? null,
  });
  if (staffError) throw new Error(staffError.message);
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
      status: row.status,
      classroomName: classroomId ? classrooms.get(classroomId) ?? null : null,
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
          instructorName: instructorId ? staffNames.get(instructorId) ?? null : null,
          cancelReason: null,
        });
      }
      current = addDays(current, 1);
    }
  }

  return items.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

export async function createScheduleRule(academyId: string, input: CreateScheduleRuleInput): Promise<void> {
  const { data: profile, error: profileError } = await lmsDb
    .from('class_profiles')
    .select('default_classroom_id,default_instructor_staff_id')
    .eq('class_id', input.classId)
    .single();
  if (profileError) throw new Error(profileError.message);

  const { error } = await lmsDb.from('class_schedule_rules').insert({
    academy_id: academyId,
    class_id: input.classId,
    day_of_week: input.dayOfWeek,
    start_time: input.startTime,
    end_time: input.endTime,
    start_date: input.startDate,
    end_date: input.endDate || null,
    classroom_id: input.classroomId || profile?.default_classroom_id || null,
    instructor_staff_id: input.instructorId || profile?.default_instructor_staff_id || null,
  });

  if (error) throw new Error(error.message);
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

export async function setClassBook(classId: string, bookId: string, active: boolean): Promise<void> {
  if (!classId || !bookId) throw new Error('반과 교재를 선택하세요.');

  const { error } = await coreDb
    .from('class_books')
    .upsert({ class_id: classId, book_id: bookId, active }, { onConflict: 'class_id,book_id' });
  if (error) throw new Error(error.message);
}

async function ensureOccurrence(academyId: string, input: RecordAttendanceInput): Promise<string> {
  if (input.occurrenceId) return input.occurrenceId;

  const row = {
    academy_id: academyId,
    class_id: input.classId,
    rule_id: input.ruleId || null,
    occurrence_date: input.date,
    start_time: input.startTime,
    end_time: input.endTime,
    status: 'scheduled',
  };

  const { data, error } = await lmsDb.from('lesson_occurrences').insert(row).select('id').single();
  if (!error) return requireData(data, null).id;

  const maybeDuplicate = (error as Row).code === '23505';
  if (!maybeDuplicate) throw new Error(error.message);

  let query = lmsDb
    .from('lesson_occurrences')
    .select('id')
    .eq('academy_id', academyId)
    .eq('class_id', input.classId)
    .eq('occurrence_date', input.date)
    .eq('start_time', input.startTime);

  query = input.ruleId ? query.eq('rule_id', input.ruleId) : query.is('rule_id', null);
  const { data: existing, error: existingError } = await query.limit(1).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing?.id) throw new Error('수업 회차를 생성하지 못했습니다.');
  return existing.id;
}

export async function recordAttendance(academyId: string, input: RecordAttendanceInput): Promise<void> {
  if (!input.studentId) throw new Error('학생을 선택하세요.');

  const occurrenceId = await ensureOccurrence(academyId, input);
  const defaultMinutes = ['absent', 'excused'].includes(input.status)
    ? 0
    : minutesBetween(input.startTime, input.endTime);

  const { error } = await lmsDb.from('attendance_records').upsert({
    academy_id: academyId,
    occurrence_id: occurrenceId,
    student_id: input.studentId,
    status: input.status,
    attended_minutes: input.attendedMinutes ?? defaultMinutes,
    billable_minutes: input.billableMinutes ?? defaultMinutes,
    notes: input.notes || null,
  }, { onConflict: 'occurrence_id,student_id' });

  if (error) throw new Error(error.message);
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
  return drafts.map(({ student, draft }) => {
    const invoice = invoices.get(student.id);
    const expectedAmount = draft?.totalAmount ?? 0;
    return {
      studentId: student.id,
      studentName: student.name,
      billingMode: student.billingMode,
      expectedAmount,
      invoicedAmount: toNumber(invoice?.total_amount, expectedAmount),
      paidAmount: toNumber(invoice?.paid_amount),
      status: invoice?.status || 'not_issued',
      invoiceId: invoice?.id ?? null,
    };
  });
}

export async function generateMonthlyInvoices(academyId: string, serviceMonth: string): Promise<void> {
  const drafts = await buildBillingDrafts(academyId, serviceMonth);
  const [year, month] = serviceMonth.split('-').map(Number);
  const dueDate = `${serviceMonth}-${String(Math.min(28, new Date(year, month, 0).getDate())).padStart(2, '0')}`;

  const { data: existingInvoices, error: existingError } = await lmsDb
    .from('invoices')
    .select('id,student_id,paid_amount')
    .eq('academy_id', academyId)
    .eq('service_month', serviceMonth);
  if (existingError) throw new Error(existingError.message);

  const existingMap = new Map((existingInvoices || []).map((row: Row) => [row.student_id, row]));

  for (const { student, draft } of drafts) {
    if (!draft) continue;
    const existing = existingMap.get(student.id);
    const paidAmount = toNumber(existing?.paid_amount);
    const status = draft.totalAmount <= 0
      ? 'draft'
      : paidAmount >= draft.totalAmount
        ? 'paid'
        : paidAmount > 0
          ? 'partial'
          : 'issued';

    const { data: invoice, error: invoiceError } = await lmsDb
      .from('invoices')
      .upsert({
        academy_id: academyId,
        student_id: student.id,
        service_month: serviceMonth,
        due_date: dueDate,
        subtotal_amount: draft.subtotalAmount,
        discount_amount: draft.discountAmount,
        total_amount: draft.totalAmount,
        status,
      }, { onConflict: 'student_id,service_month' })
      .select('id')
      .single();
    if (invoiceError) throw new Error(invoiceError.message);

    const { error: deleteLinesError } = await lmsDb.from('invoice_lines').delete().eq('invoice_id', invoice.id);
    if (deleteLinesError) throw new Error(deleteLinesError.message);
    if (draft.lines.length > 0) {
      const { error: lineError } = await lmsDb.from('invoice_lines').insert(
        draft.lines.map((line) => ({
          invoice_id: invoice.id,
          line_type: line.lineType,
          class_id: line.classId,
          occurrence_id: line.occurrenceId,
          description: line.description,
          quantity: line.quantity,
          unit_amount: line.unitAmount,
          amount: line.amount,
        })),
      );
      if (lineError) throw new Error(lineError.message);
    }
  }
}

export async function getDashboardData(academyId: string, serviceMonth: string): Promise<DashboardData> {
  const [classes, students, weakTypes, billing, aiCount] = await Promise.all([
    listClassSummaries(academyId),
    listStudents(academyId),
    listWeakTypes(academyId, 12),
    listBilling(academyId, serviceMonth),
    countAiConversations(academyId),
  ]);

  return { classes, students, weakTypes, billing, aiConversationCount: aiCount };
}

async function countAiConversations(academyId: string): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const { count, error } = await aiDb
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('academy_id', academyId)
    .gte('created_at', since.toISOString());
  if (error) return 0;
  return count || 0;
}
