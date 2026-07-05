import { aiDb, coreDb, lmsDb, reportingDb } from '@/core/supabaseClient';
import type {
  BillingMode,
  BillingRow,
  ClassSummary,
  CreateClassInput,
  CreateScheduleRuleInput,
  CreateStaffInput,
  CreateStudentInput,
  DashboardData,
  ScheduleItem,
  StaffSummary,
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

function mapById<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
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

async function fetchStaffPeople(staffRows: Row[]): Promise<Map<string, string>> {
  const people = await fetchPeople(staffRows.map((row) => row.person_id));
  const names = new Map<string, string>();
  for (const staff of staffRows) {
    const person = people.get(staff.person_id);
    names.set(staff.id, person?.display_name || person?.full_name || '이름없음');
  }
  return names;
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
      name: person?.display_name || person?.full_name || '이름없음',
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
      name: person?.display_name || person?.full_name || '이름없음',
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

  const classRows = (input.classIds || []).map((classId) => ({
    class_id: classId,
    student_id: createdStudent.id,
    status: 'active',
  }));
  if (classRows.length > 0) {
    const { error } = await coreDb.from('class_students').insert(classRows);
    if (error) throw new Error(error.message);
  }

  const { error: contractError } = await lmsDb.from('student_billing_contracts').insert({
    academy_id: academyId,
    student_id: createdStudent.id,
    billing_mode: input.billingMode,
    base_monthly_fee: input.baseMonthlyFee || 0,
    hourly_rate: input.hourlyRate ?? null,
    status: 'active',
  });
  if (contractError) throw new Error(contractError.message);
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
  const [{ data: classesData, error: classesError }, { data: profilesData, error: profilesError }, { data: rulesData, error: rulesError }, { data: occurrencesData, error: occurrencesError }, { data: classroomsData, error: classroomsError }, { data: staffData, error: staffError }] = await Promise.all([
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
    actualKeys.add(`${row.rule_id || 'none'}:${row.occurrence_date}:${normalizeTime(row.start_time)}`);
    const profile = profiles.get(row.class_id);
    const instructorId = row.substitute_staff_id || row.instructor_staff_id || profile?.default_instructor_staff_id;
    const classroomId = row.classroom_id || profile?.default_classroom_id;
    items.push({
      id: row.id,
      actualId: row.id,
      virtual: false,
      classId: row.class_id,
      className: classes.get(row.class_id) || '이름없는 반',
      ruleId: row.rule_id ?? null,
      date: row.occurrence_date,
      startTime: normalizeTime(row.start_time),
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
      const key = `${rule.id}:${date}:${start}`;
      if (day === rule.day_of_week && weekOffset >= 0 && weekOffset % rule.interval_weeks === 0 && !actualKeys.has(key)) {
        const profile = profiles.get(rule.class_id);
        const classroomId = rule.classroom_id || profile?.default_classroom_id;
        const instructorId = rule.instructor_staff_id || profile?.default_instructor_staff_id;
        items.push({
          id: `virtual:${rule.id}:${date}`,
          actualId: null,
          virtual: true,
          classId: rule.class_id,
          className: classes.get(rule.class_id) || '이름없는 반',
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
    studentName: row.student_name || '이름없음',
    classId: row.class_id ?? null,
    typeName: row.type_name || '유형 없음',
    sampleCount: toNumber(row.sample_count),
    correctCount: toNumber(row.correct_count),
    score: row.score === null || row.score === undefined ? null : Number(row.score),
    status: row.status,
    lastAttemptedAt: row.last_attempted_at ?? null,
  }));
}

export async function listBilling(academyId: string, serviceMonth: string): Promise<BillingRow[]> {
  const [students, { data: invoicesData, error: invoicesError }] = await Promise.all([
    listStudents(academyId),
    lmsDb.from('invoices').select('id,student_id,total_amount,paid_amount,status').eq('academy_id', academyId).eq('service_month', serviceMonth),
  ]);
  if (invoicesError) throw new Error(invoicesError.message);

  const invoices = new Map((invoicesData || []).map((row: Row) => [row.student_id, row]));
  return students.map((student) => {
    const invoice = invoices.get(student.id);
    const expectedAmount = student.billingMode === 'usage_based' ? 0 : student.baseMonthlyFee;
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
  const students = await listStudents(academyId);
  const { data: contractsData, error: contractsError } = await lmsDb
    .from('student_billing_contracts')
    .select('*')
    .eq('academy_id', academyId)
    .eq('status', 'active');
  if (contractsError) throw new Error(contractsError.message);

  const contracts = new Map((contractsData || []).map((row: Row) => [row.student_id, row]));
  const [year, month] = serviceMonth.split('-').map(Number);
  const dueDate = `${serviceMonth}-${String(Math.min(28, new Date(year, month, 0).getDate())).padStart(2, '0')}`;

  for (const student of students) {
    const contract = contracts.get(student.id);
    if (!contract) continue;

    const base = toNumber(contract.base_monthly_fee);
    const total = contract.billing_mode === 'usage_based' ? 0 : base;
    const { data: invoice, error: invoiceError } = await lmsDb
      .from('invoices')
      .upsert({
        academy_id: academyId,
        student_id: student.id,
        service_month: serviceMonth,
        due_date: dueDate,
        subtotal_amount: total,
        discount_amount: 0,
        total_amount: total,
        status: total > 0 ? 'issued' : 'draft',
      }, { onConflict: 'student_id,service_month' })
      .select('id')
      .single();
    if (invoiceError) throw new Error(invoiceError.message);

    await lmsDb.from('invoice_lines').delete().eq('invoice_id', invoice.id);
    if (total > 0) {
      const { error: lineError } = await lmsDb.from('invoice_lines').insert({
        invoice_id: invoice.id,
        line_type: 'base_fee',
        description: '월 기본 수강료',
        quantity: 1,
        unit_amount: total,
        amount: total,
      });
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
