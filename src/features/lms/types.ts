export type BillingMode = 'monthly_plus_classes' | 'usage_based' | 'manual';
export type BillingClassRuleType = 'included' | 'extra_flat' | 'discount' | 'usage_based';
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused' | 'makeup';
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'cancelled' | 'refunded';
export type PayrollStatus = 'pending' | 'paid' | 'cancelled';
export type WithholdingType = 'none' | 'freelance_3.3' | 'custom';
export type StudentStatus = 'active' | 'inactive' | 'on_leave' | 'graduated' | 'dropped';
export type StaffRole = 'admin' | 'teacher' | 'instructor' | 'staff';
export type StaffStatus = 'active' | 'inactive' | 'on_leave';
export type ClassStatus = 'active' | 'inactive' | 'archived';
export type LessonOccurrenceStatus = 'scheduled' | 'completed' | 'cancelled' | 'makeup' | 'substitute';
export type StudentLearningPeriod = '30d' | '90d' | '180d' | 'all';
export type StudentLearningStatus = 'insufficient' | 'weak' | 'watch' | 'ok';
export type StudentAssignmentProgressStatus = 'not_started' | 'in_progress' | 'completed';
export type AdminExportType = 'tax' | 'payroll';
export type AdminResetTarget =
  | 'classrooms'
  | 'classes'
  | 'lessons'
  | 'schedules'
  | 'students'
  | 'instructors'
  | 'courses'
  | 'enrollments'
  | 'accounting'
  | 'all';

export interface AdminExportOptions {
  startDate: string;
  endDate: string;
  includeRevenue?: boolean;
  includePayroll?: boolean;
  includeExpenses?: boolean;
  includeProfitLoss?: boolean;
}

export interface AdminCsvExport {
  filename: string;
  csv: string;
}

export interface ClassSummary {
  id: string;
  name: string;
  grade: string | null;
  active: boolean;
  status: string;
  color: string | null;
  capacity: number | null;
  defaultInstructorId: string | null;
  defaultClassroomId: string | null;
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
  status: StudentStatus;
  classIds: string[];
  classNames: string[];
  billingMode: BillingMode | null;
  baseMonthlyFee: number;
  hourlyRate: number | null;
  extraClassFee: number;
  weakTypeCount?: number;
  avgTypeScore?: number | null;
  lastLearningAt?: string | null;
  learningMetricsLoaded?: boolean;
}

export interface StudentClassBillingInput {
  classId: string;
  ruleType: BillingClassRuleType;
  amount: number;
}

export interface StudentOperationsPermissions {
  canCreate: boolean;
  canEdit: boolean;
  canArchive: boolean;
  canViewBilling: boolean;
  canHardDelete: boolean;
  scopedToAssignedClasses: boolean;
}

export interface StudentOperationsOverview {
  students: StudentSummary[];
  classes: ClassSummary[];
  permissions: StudentOperationsPermissions;
}

export type StudentDetailSection = 'learning' | 'attendance' | 'billing' | 'management' | 'full';

export interface StudentLearningMetric {
  studentId: string;
  weakTypeCount: number;
  avgTypeScore: number | null;
  lastLearningAt: string | null;
}

export interface StudentLearningAttemptRow {
  id: number;
  problemId: string;
  assignmentId: string | null;
  assignmentTitle: string | null;
  unitId: string | null;
  unitName: string | null;
  typeId: string | null;
  typeName: string | null;
  label: string;
  correct: boolean;
  unsure: boolean;
  attemptNo: number;
  durationMs: number | null;
  createdAt: string;
}

export interface StudentTypeInsight {
  typeId: string | null;
  typeName: string;
  sampleCount: number;
  correctCount: number;
  score: number | null;
  status: StudentLearningStatus;
  lastAttemptedAt: string | null;
}

export interface StudentUnitInsight {
  unitId: string | null;
  unitName: string;
  bookId: string | null;
  bookTitle: string | null;
  sampleCount: number;
  correctCount: number;
  score: number | null;
  status: StudentLearningStatus;
  weakTypeCount: number;
  typeCount: number;
  lastAttemptedAt: string | null;
  types: StudentTypeInsight[];
}

export interface StudentAssignmentInsight {
  id: string;
  title: string;
  dueAt: string | null;
  status: string;
  active: boolean;
  sourceType: 'content_scope' | 'worksheet';
  bookTitle: string | null;
  progressStatus: StudentAssignmentProgressStatus;
  requiredProblemCount: number;
  attemptedProblemCount: number;
  attemptCount: number;
  correctAttemptCount: number;
  correctRate: number | null;
  lastActivityAt: string | null;
}

export interface StudentLearningOverview {
  attemptedProblemCount: number;
  attemptCount: number;
  correctAttemptCount: number;
  correctRate: number | null;
  weakTypeCount: number;
  watchTypeCount: number;
  unitCount: number;
  assignmentCount: number;
  completedAssignmentCount: number;
  aiConversationCount: number;
  lastLearningAt: string | null;
}

export interface StudentLearningAnalytics {
  period: StudentLearningPeriod;
  assignmentId: string | null;
  overview: StudentLearningOverview;
  units: StudentUnitInsight[];
  assignments: StudentAssignmentInsight[];
}

export interface StudentAttendanceSummary {
  present: number;
  late: number;
  absent: number;
  excused: number;
  makeup: number;
  total: number;
}

export interface StudentAiConversationRow {
  id: string;
  assignmentId: string | null;
  assignmentTitle: string | null;
  title: string | null;
  status: string;
  sourceApp: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  messages?: StudentAiMessageRow[];
}

export interface StudentAiMessageRow {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface StudentReportRow {
  id: string;
  reportType: string;
  title: string | null;
  status: string;
  generatedAt: string;
}

export interface StudentDeletionBlocker {
  key: string;
  label: string;
  count: number;
}

export interface StudentHardDeletePreview {
  studentId: string;
  studentName: string;
  canHardDelete: boolean;
  historicalRecordCount: number;
  sharedIdentityCount: number;
  blockers: StudentDeletionBlocker[];
}

export interface StudentMutationTableSummary {
  schema: string;
  table: string;
  operation: string;
  affectedRows: number;
}

export interface StudentMutationResult {
  studentId: string;
  studentName: string;
  tables: StudentMutationTableSummary[];
  totalAffectedRows: number;
  authUserIds?: string[];
}

export interface StudentDetail {
  summary: StudentSummary;
  permissions: StudentOperationsPermissions;
  loadedSections: StudentDetailSection[];
  signupInvitation: StudentSignupInvitation | null;
  hasGradeAppAccount: boolean;
  learningAnalytics: StudentLearningAnalytics | null;
  weakTypes: WeakTypeRow[];
  recentAttempts: StudentLearningAttemptRow[];
  attendanceSummary: StudentAttendanceSummary;
  recentAttendance: AttendanceRow[];
  billing: BillingRow | null;
  recentPayments: PaymentRow[];
  aiConversations: StudentAiConversationRow[];
  reports: StudentReportRow[];
  hardDeletePreview: StudentHardDeletePreview | null;
}

export interface StaffSummary {
  id: string;
  personId: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: StaffRole | 'owner';
  status: StaffStatus;
  hourlyRate: number | null;
}

export interface ClassroomSummary {
  id: string;
  name: string;
  capacity: number | null;
  color: string | null;
  active: boolean;
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
  status: LessonOccurrenceStatus;
  classroomName: string | null;
  instructorId: string | null;
  instructorName: string | null;
  cancelReason: string | null;
}

export interface ScheduleRuleSummary {
  id: string;
  classId: string;
  className: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  startDate: string;
  endDate: string | null;
  active: boolean;
  classroomName: string | null;
  instructorId: string | null;
  instructorName: string | null;
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

export interface PaymentRow {
  id: string;
  invoiceId: string | null;
  studentId: string;
  studentName: string;
  paymentDate: string;
  amount: number;
  paymentMethod: string | null;
  status: PaymentStatus;
  notes: string | null;
}

export interface ExpenseRow {
  id: string;
  expenseDate: string;
  category: string;
  amount: number;
  paymentMethod: string | null;
  recipient: string | null;
  description: string | null;
  taxDeductible: boolean;
  hasReceipt: boolean;
  notes: string | null;
}

export interface InstructorPaymentRow {
  id: string;
  instructorId: string | null;
  instructorName: string | null;
  recipientName: string | null;
  serviceMonth: string;
  paymentDate: string;
  grossAmount: number;
  withholdingType: WithholdingType;
  withholdingRate: number;
  withholdingTax: number;
  localTax: number;
  netAmount: number;
  hoursWorked: number | null;
  hourlyRate: number | null;
  paymentMethod: string | null;
  status: PayrollStatus;
  notes: string | null;
}

export interface AccountingOperationsOverview {
  billing: BillingRow[];
  payments: PaymentRow[];
  expenses: ExpenseRow[];
  payroll: InstructorPaymentRow[];
  staff: StaffSummary[];
}

export interface BookSummary {
  id: string;
  bookKey: string;
  title: string;
  subject: string | null;
  grade: string | null;
}

export interface AssignmentProblemSummary {
  id: string;
  bookId: string;
  unitId: string;
  problemTypeId: string | null;
  number: string;
  pagePrinted: number;
  typeName: string | null;
}

export interface AssignmentProblemTypeSummary {
  id: string;
  unitId: string | null;
  name: string;
  problemCount: number;
}

export interface AssignmentUnitSummary {
  id: string;
  name: string;
  partName: string | null;
  problemCount: number;
}

export interface AssignmentBookSummary extends BookSummary {
  units: AssignmentUnitSummary[];
  problemTypes: AssignmentProblemTypeSummary[];
  problems: AssignmentProblemSummary[];
}

export type AssignmentStudentProgressStatus = 'not_started' | 'in_progress' | 'completed';

export interface AssignmentOperationsPermissions {
  canCreate: boolean;
  canManageAll: boolean;
  canManageRecipients: boolean;
  scopedToAssignedClasses: boolean;
}

export interface AssignmentProgressSummary {
  targetStudentCount: number;
  notStartedCount: number;
  inProgressCount: number;
  completedCount: number;
  completionRate: number;
  attemptCount: number;
  correctAttemptCount: number;
  correctRate: number | null;
  lastActivityAt: string | null;
}

export interface AssignmentClassProgressSummary extends AssignmentProgressSummary {
  classId: string | null;
  className: string;
}

export interface LearningAssignmentSummary {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  sourceType: 'content_scope' | 'worksheet';
  status: string;
  active: boolean;
  bookTitle: string | null;
  problemCount: number;
  targetLabels: string[];
  classIds: string[];
  classProgress: AssignmentClassProgressSummary[];
  progress: AssignmentProgressSummary;
  createdAt: string;
}

export interface AssignmentRecipientProgress {
  id: string;
  studentId: string;
  studentName: string;
  classId: string | null;
  className: string | null;
  status: AssignmentStudentProgressStatus;
  requiredProblemCount: number;
  attemptedProblemCount: number;
  attemptCount: number;
  correctAttemptCount: number;
  correctRate: number | null;
  lastActivityAt: string | null;
}

export interface AssignmentProblemProgress {
  problemId: string;
  label: string;
  unitId: string | null;
  unitName: string | null;
  typeName: string | null;
  attemptCount: number;
  correctAttemptCount: number;
  correctRate: number | null;
  attemptedStudentCount: number;
}

export interface LearningAssignmentDetail {
  assignment: LearningAssignmentSummary;
  recipients: AssignmentRecipientProgress[];
  problems: AssignmentProblemProgress[];
  candidateStudents: StudentSummary[];
}

export interface AssignmentManagementData {
  assignments: LearningAssignmentSummary[];
  books: AssignmentBookSummary[];
  classes: ClassSummary[];
  students: StudentSummary[];
  permissions: AssignmentOperationsPermissions;
}

export interface CreateLearningAssignmentInput {
  title: string;
  description?: string | null;
  bookId?: string | null;
  unitIds?: string[];
  problemTypeIds?: string[];
  problemIds?: string[];
  classIds?: string[];
  studentIds?: string[];
  excludedStudentIds?: string[];
  dueAt?: string | null;
  context?: string | null;
  sourceType?: 'content_scope' | 'worksheet';
}

export interface CreateBookInput {
  bookKey?: string | null;
  title: string;
  subject?: string | null;
  grade?: string | null;
}

export interface UpdateBookInput {
  title: string;
  subject?: string | null;
  grade?: string | null;
}

export interface ClassBookSummary extends BookSummary {
  assignedAt: string;
  active: boolean;
}

export interface ClassStudentSummary {
  id: string;
  personId: string;
  name: string;
  status: string;
}

export interface AttendanceRow {
  id: string;
  occurrenceId: string;
  studentId: string;
  studentName: string;
  classId: string;
  className: string;
  date: string;
  startTime: string;
  endTime: string;
  status: AttendanceStatus;
  attendedMinutes: number | null;
  billableMinutes: number | null;
  notes: string | null;
}

export interface ClassOperationsOverview {
  classes: ClassSummary[];
  schedule: ScheduleItem[];
  scheduleRules: ScheduleRuleSummary[];
  books: BookSummary[];
  attendance: AttendanceRow[];
  staff: StaffSummary[];
  classrooms: ClassroomSummary[];
}

export interface ClassOperationsDetail {
  students: ClassStudentSummary[];
  books: ClassBookSummary[];
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

export interface CreateClassroomInput {
  name: string;
  capacity?: number | null;
  color?: string | null;
}

export interface UpdateClassroomInput extends CreateClassroomInput {
  active: boolean;
}

export interface UpdateClassInput extends CreateClassInput {
  status: ClassStatus;
  active: boolean;
}

export interface CreateStudentInput {
  name: string;
  phone?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  schoolType?: string | null;
  grade?: string | null;
  classIds?: string[];
  classBillingRules?: StudentClassBillingInput[];
  billingMode: BillingMode;
  baseMonthlyFee: number;
  hourlyRate?: number | null;
}

export interface StudentSignupInvitation {
  id?: string;
  inviteCode: string;
  expiresAt: string;
  loginHint: string | null;
}

export interface CreateStudentResult {
  studentId: string;
  studentName: string;
  invitation: StudentSignupInvitation;
}

export interface UpdateStudentInput extends CreateStudentInput {
  status: StudentStatus;
}

export interface CreateStaffInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  role: StaffRole;
  hourlyRate?: number | null;
}

export interface UpdateStaffInput extends CreateStaffInput {
  status: StaffStatus;
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

export interface UpdateScheduleRuleInput extends CreateScheduleRuleInput {
  active: boolean;
}

export interface RecordPaymentInput {
  invoiceId?: string | null;
  studentId: string;
  paymentDate: string;
  amount: number;
  paymentMethod?: string | null;
  payerName?: string | null;
  status?: PaymentStatus;
  notes?: string | null;
}

export interface CreateExpenseInput {
  expenseDate: string;
  category: string;
  amount: number;
  paymentMethod?: string | null;
  recipient?: string | null;
  description?: string | null;
  taxDeductible?: boolean;
  hasReceipt?: boolean;
  notes?: string | null;
}

export interface CreateInstructorPaymentInput {
  instructorId?: string | null;
  recipientName?: string | null;
  serviceMonth: string;
  paymentDate: string;
  grossAmount: number;
  withholdingType?: WithholdingType;
  withholdingRate?: number;
  withholdingTax?: number;
  localTax?: number;
  netAmount?: number;
  hoursWorked?: number | null;
  hourlyRate?: number | null;
  paymentMethod?: string | null;
  status?: PayrollStatus;
  notes?: string | null;
}

export interface RecordAttendanceInput {
  occurrenceId?: string | null;
  classId: string;
  ruleId?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  studentId: string;
  status: AttendanceStatus;
  attendedMinutes?: number | null;
  billableMinutes?: number | null;
  notes?: string | null;
}

export interface UpdateLessonOccurrenceInput {
  occurrenceId?: string | null;
  classId: string;
  ruleId?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  status: LessonOccurrenceStatus;
  cancelReason?: string | null;
  notes?: string | null;
}
