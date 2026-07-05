export type BillingMode = 'monthly_plus_classes' | 'usage_based' | 'manual';

export interface ClassSummary {
  id: string;
  name: string;
  grade: string | null;
  active: boolean;
  status: string;
  color: string | null;
  capacity: number | null;
  courseTitle: string | null;
  instructorName: string | null;
  classroomName: string | null;
  studentCount: number;
  weakTypeCount: number;
  avgTypeScore: number | null;
  lastLearningAt: string | null;
}

export interface StudentSummary {
  id: string;
  personId: string;
  name: string;
  phone: string | null;
  parentName: string | null;
  parentPhone: string | null;
  schoolType: string | null;
  grade: string | null;
  status: string;
  classNames: string[];
  billingMode: BillingMode | null;
  baseMonthlyFee: number;
  hourlyRate: number | null;
}

export interface StaffSummary {
  id: string;
  personId: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string;
  status: string;
  hourlyRate: number | null;
}

export interface ScheduleItem {
  id: string;
  actualId: string | null;
  virtual: boolean;
  classId: string;
  className: string;
  ruleId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  classroomName: string | null;
  instructorName: string | null;
  cancelReason: string | null;
}

export interface WeakTypeRow {
  studentId: string;
  studentName: string;
  classId: string | null;
  typeName: string;
  sampleCount: number;
  correctCount: number;
  score: number | null;
  status: string;
  lastAttemptedAt: string | null;
}

export interface BillingRow {
  studentId: string;
  studentName: string;
  billingMode: BillingMode | null;
  expectedAmount: number;
  invoicedAmount: number;
  paidAmount: number;
  status: string;
  invoiceId: string | null;
}

export interface DashboardData {
  classes: ClassSummary[];
  students: StudentSummary[];
  weakTypes: WeakTypeRow[];
  billing: BillingRow[];
  aiConversationCount: number;
}

export interface CreateClassInput {
  name: string;
  grade?: string | null;
  capacity?: number | null;
  color?: string | null;
  defaultInstructorId?: string | null;
  defaultClassroomId?: string | null;
}

export interface CreateStudentInput {
  name: string;
  phone?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  schoolType?: string | null;
  grade?: string | null;
  classIds?: string[];
  billingMode: BillingMode;
  baseMonthlyFee: number;
  hourlyRate?: number | null;
}

export interface CreateStaffInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  role: 'admin' | 'teacher' | 'instructor' | 'staff';
  hourlyRate?: number | null;
}

export interface CreateScheduleRuleInput {
  classId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  startDate: string;
  endDate?: string | null;
  classroomId?: string | null;
  instructorId?: string | null;
}
