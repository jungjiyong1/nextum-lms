// Renderer-side types

export interface Classroom {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  name: string;
}

export interface Lesson {
  id: number;
  classroomId: number;
  day: number | null;
  startSlot: number | null;
  endSlot: number | null;
  title: string;
  instructor: string;
  instructorId: number | null;
  note: string;
}

// Raw DB Representation
export interface LessonRow {
  id: number;
  classroom_id: number;
  title: string;
  instructor: string;
  instructor_id?: number | null;
  course_id?: number | null;
  note?: string | null;
  day?: number | null;
  start_slot?: number | null;
  end_slot?: number | null;
}

export interface ScheduleLesson {
  id: number;
  lessonId: number;
  ruleId: number | null;
  classroomId: number;
  day: number;
  startSlot: number;
  endSlot: number;
  title: string;
  instructor: string;
  instructorId: number | null;
  note: string;
  date: string;
  startTime: string;
  endTime: string;
  status?: 'scheduled' | 'completed' | 'cancelled' | 'makeup';
  // Feature 3: 대타/휴강 관련 필드
  substituteInstructorId?: number | null;
  substituteInstructorName?: string | null;
  cancelReason?: string | null;
}

// Feature 1: 홈 대시보드 학생 명단
export interface EnrolledStudentInfo {
  id: number;
  name: string;
  schoolGrade: string; // 예: "중2", "고1"
  phone: string | null;
  parentPhone: string | null;
}

export interface TodayLessonWithStudents {
  id: number;
  lessonId: number;
  title: string;
  instructor: string;
  startTime: string;
  endTime: string;
  classroomName: string;
  status: 'scheduled' | 'completed' | 'cancelled' | 'makeup';
  students: EnrolledStudentInfo[];
}

// Raw Schedule Representation
export interface ScheduleRow {
  schedule_id: number;
  lesson_id: number;
  rule_id: number | null;
  date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  status: string;
  schedule_notes: string | null;
  classroom_id: number | null;
  title: string;
  instructor: string;
  instructor_id?: number | null;
  lesson_note: string | null;
  // Feature 3: 대타 강사 필드
  substitute_instructor_id?: number | null;
  substitute_instructor_name?: string | null;
  cancel_reason?: string | null;
}

export interface Day {
  index: number;
  label: string;
}

export interface SlotOption {
  value: number;
  label: string;
}

export interface GridMetrics {
  gridRect: DOMRect;
  timeWidth: number;
  headerHeight: number;
  rowHeight: number;
  dayCount: number;
  dayWidth: number;
}

export interface LessonPlacement {
  dayIndex: number;
  startSlot: number;
  endSlot: number;
  metrics: GridMetrics;
}

export interface DrawState {
  startX: number;
  startY: number;
  ghost: SVGRectElement;
  bounds: DOMRect;
}

export interface MoveState {
  id: number;
  offsetX: number;
  offsetY: number;
  bounds: DOMRect;
  lastValid: { x: number; y: number };
}

export interface ResizeState {
  id: number;
  handle: string;
  bounds: DOMRect;
  origin: { x: number; y: number; width: number; height: number };
  startX: number;
  startY: number;
}

export interface SelectionState {
  day: number;
  startSlot: number;
  endSlot: number;
}

export interface LessonDragState {
  lessonId: number;
  classroomId: number;
  block: HTMLElement;
  ghost?: HTMLElement | null;
  offsetX: number;
  offsetY: number;
  duration: number;
  candidate: { day: number; startSlot: number; endSlot: number } | null;
  moved: boolean;
  dragging: boolean;
  startX: number;
  startY: number;
  blockRect: DOMRect;
}

export interface LessonResizeState {
  lessonId: number;
  classroomId: number;
  edge: 'start' | 'end';
  block: HTMLElement;
  ghost?: HTMLElement | null;
  startSlot: number;
  endSlot: number;
  day: number;
  previewStart?: number;
  previewEnd?: number;
  previewTime?: string;
  originalStartSlot?: number;
  originalEndSlot?: number;
}

export type ViewMode = 'multi' | 'single';

// --- Domain Entity Types ---

export interface Student {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  enrollment_date: string | null;
  status: 'active' | 'on_leave' | 'dropped';
  parent_name: string | null;
  parent_phone: string | null;
  monthly_tuition: number | null;
  payment_cycle_day: number;
  last_payment_date: string | null;
  notes: string | null;
  school_type: 'elementary' | 'middle' | 'high' | null;
  grade: number | null;
}

export interface Instructor {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  hourly_rate: number | null;
  qualifications: string | null;
  hire_date: string | null;
  status: 'active' | 'inactive' | 'on_leave';
  notes: string | null;
}

export interface Enrollment {
  id: number;
  lesson_title: string;
  day: number | null;
  start_slot: number | null;
  end_slot: number | null;
  classroom_name: string;
  instructor_name: string;
}

export interface StudentPayment {
  id: number;
  payment_date: string;
  amount: number;
  payment_method: string;
  status: string;
  notes: string | null;
}

export interface InstructorPayment {
  id: number;
  payment_date: string;
  amount: number;
  hours_worked: number | null;
  status: string;
  notes: string | null;
}

export interface InstructorScheduleItem {
  schedule_id: number;
  lesson_id: number;
  rule_id: number | null;
  date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  lesson_title: string;
  classroom_name: string;
  classroom_id: number;
  status: string;
  instructor_name: string;
  instructor_id: number;
  substitute_instructor_id: number | null;
  substitute_instructor_name: string | null;
}

export interface SalaryData {
  instructor: { id: number; name: string; hourly_rate: number | null };
  totalMinutes: number;
  totalHours: number;
  estimatedSalary: number;
}

export interface InstructorLessonSummary {
  lesson_id: number;
  title: string;
  day: number | null;
  start_slot: number | null;
  end_slot: number | null;
  classroom_name: string;
  classroom_id: number;
  rule_id: number | null;
}

// Irregular lesson schedule (one-time lessons without lesson_rules)
export interface IrregularLessonSchedule {
  schedule_id: number;
  lesson_id: number;
  date: string;
  start_time: string;
  end_time: string;
  lesson_title: string;
  classroom_name: string;
}

// Accounting Types
export interface Expense {
  id: number;
  expense_date: string;
  category: string;
  description: string;
  amount: number;
  payment_method: string | null;
  recipient: string | null;
  tax_deductible: boolean;
  has_receipt: boolean;
  notes?: string;
}

export interface OtherIncome {
  id: number;
  income_date: string;
  category: string;
  description: string;
  amount: number;
  payment_method: string | null;
  payer: string | null;
  notes?: string;
}

export interface PayrollRecord {
  id: number;
  payroll_date: string;
  instructor_name: string;
  total_amount: number;
  status: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Window API types
export interface WindowApi {
  listClassrooms: () => Promise<Classroom[]>;
  createClassroom: (data: Partial<Classroom>) => Promise<Classroom>;
  updateClassroomPosition: (id: number, x: number, y: number) => Promise<void>;
  updateClassroomRect: (id: number, x: number, y: number, width: number, height: number) => Promise<void>;
  renameClassroom: (id: number, name: string) => Promise<void>;
  deleteClassroom: (id: number) => Promise<void>;
  resetClassrooms: () => Promise<void>;
  listLessons: () => Promise<LessonRow[]>;
  createLesson: (data: Partial<Lesson>) => Promise<LessonRow | { lesson: LessonRow }>;
  updateLesson: (data: Partial<Lesson>) => Promise<void>;
  updateLessonRule: (data: { ruleId: number; day: number; startSlot: number; endSlot: number; startDate?: string | null; endDate?: string | null; effectiveFromDate?: string }) => Promise<void>;
  deleteLesson: (id: number) => Promise<void>;
  resetLessons: () => Promise<void>;

  instructors: {
    list: (filters?: { status?: string }) => Promise<Instructor[]>;
    get: (id: number) => Promise<Instructor>;
    search: (query: string) => Promise<Instructor[]>;
    create: (data: Partial<Instructor>) => Promise<ApiResponse<Instructor>>;
    update: (payload: Partial<Instructor> & { id: number }) => Promise<ApiResponse<Instructor>>;
    delete: (id: number) => Promise<ApiResponse<void>>;
    monthlySalary: (payload: { id: number; year: number; month: number }) => Promise<SalaryData>;
    lessons: (id: number) => Promise<InstructorLessonSummary[]>;
  };

  students: {
    list: (filters?: { status?: string }) => Promise<Student[]>;
    get: (id: number) => Promise<Student>;
    search: (query: string) => Promise<Student[]>;
    overdue: () => Promise<Student[]>;
    create: (data: Partial<Student>) => Promise<ApiResponse<Student>>;
    update: (payload: Partial<Student> & { id: number }) => Promise<ApiResponse<Student>>;
    delete: (id: number) => Promise<ApiResponse<void>>;
    enrollments: (id: number) => Promise<Enrollment[]>;
    payments: (id: number) => Promise<StudentPayment[]>;
  };

  enrollments: {
    list: (filters?: { studentId?: number; lessonId?: number }) => Promise<Enrollment[]>;
    assign: (studentId: number, lessonId: number) => Promise<ApiResponse<void>>;
    unassign: (enrollmentId: number) => Promise<ApiResponse<void>>;
    byStudent: (studentId: number) => Promise<Enrollment[]>;
    byLesson: (lessonId: number) => Promise<any>;
    count: (lessonId: number) => Promise<number>;
  };

  schedules: {
    byRange: (startDate: string, endDate: string) => Promise<ScheduleRow[]>;
    create: (data: unknown) => Promise<unknown>;
    update: (data: unknown) => Promise<unknown>;
    delete: (id: number) => Promise<unknown>;
    reset: () => Promise<unknown>;
    instructorMonth: (instructorId: number, yearMonth: string) => Promise<InstructorScheduleItem[]>;
    instructorSalary: (instructorId: number, yearMonth: string) => Promise<SalaryData>;
    // Feature 3: 휴강/대타/보강
    cancel: (id: number, reason?: string) => Promise<{ success: boolean; error?: string }>;
    cancelPeriod: (lessonId: number, startDate: string, endDate: string, reason?: string) => Promise<{ success: boolean; count: number; error?: string }>;
    setSubstitute: (id: number, substituteInstructorId: number, substituteInstructorName: string) => Promise<{ success: boolean; error?: string }>;
    clearSubstitute: (id: number) => Promise<{ success: boolean; error?: string }>;
    createMakeup: (originalScheduleId: number, date: string, startTime: string, endTime: string, classroomId?: number) => Promise<{ success: boolean; schedule?: ScheduleLesson; error?: string }>;
    restore: (id: number) => Promise<{ success: boolean; error?: string }>;
  };

  settings: {
    get: (key: string) => Promise<string | undefined>;
    set: (key: string, value: string) => Promise<void>;
    runMigrations: () => Promise<unknown>;
  };
  resetSchedules: () => Promise<void>;

  accounting: {
    dashboard: (yearMonth?: string) => Promise<any>;
    overdue: () => Promise<any>;
    studentPayment: (data: { student_id: number; amount: number; payment_method: string; payment_date?: string; notes?: string }) => Promise<ApiResponse<void>>;
    cancelStudentPayment: (studentId: number, yearMonth: string) => Promise<ApiResponse<void>>;
    studentPayments: (studentId: number) => Promise<StudentPayment[]>;
    recentPayments: (limit?: number) => Promise<StudentPayment[]>;
    instructorPayment: (data: { instructor_id: number; amount: number; hours_worked?: number; pay_period_start?: string; pay_period_end?: string; payment_date?: string; notes?: string }) => Promise<ApiResponse<void>>;
    instructorPayments: (instructorId: number) => Promise<InstructorPayment[]>;
    recentInstructorPayments: (limit?: number) => Promise<InstructorPayment[]>;
    monthlyRevenue: (yearMonth: string) => Promise<any>;
    monthlyExpenses: (yearMonth: string) => Promise<any>;
    instructorEstimates: (yearMonth?: string) => Promise<any>;
    studentMonthlyStatus: (yearMonth?: string) => Promise<any>;
    createExpense: (data: Partial<Expense>) => Promise<ApiResponse<Expense>>;
    getExpenses: (startDate: string, endDate: string) => Promise<Expense[]>;
    deleteExpense: (id: number) => Promise<ApiResponse<void>>;
    createOtherIncome: (data: Partial<OtherIncome>) => Promise<ApiResponse<OtherIncome>>;
    getOtherIncome: (startDate: string, endDate: string) => Promise<OtherIncome[]>;
    deleteOtherIncome: (id: number) => Promise<ApiResponse<void>>;
    incomeStatement: (startDate: string, endDate: string) => Promise<any>;
    monthlyDetails: (yearMonth: string) => Promise<any>;
    createPayroll: (data: any) => Promise<ApiResponse<void>>;
    listPayroll: (yearMonth?: string) => Promise<PayrollRecord[]>;
    getPayrollSummary: (year: string) => Promise<any>;
    estimateIncomeTax: (year: string) => Promise<any>;
    getWithholdingSummary: (year: string) => Promise<any>;
    getDeductibleExpenses: (startDate: string, endDate: string) => Promise<any>;
    getTaxSettings: () => Promise<any>;
    updateTaxSettings: (payload: Record<string, string>) => Promise<any>;
    getVatSummary: (year: string) => Promise<any>;
    exportTaxReport: (options: any) => Promise<string>;
    exportPayrollReport: (options: any) => Promise<string>;
  };
}

declare global {
  interface Window {
    api: WindowApi;
  }
}
