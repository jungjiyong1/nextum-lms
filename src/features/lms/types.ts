export type BillingMode = 'monthly_plus_classes' | 'usage_based' | 'manual';
export type BillingClassRuleType = 'included' | 'extra_flat' | 'discount' | 'usage_based';
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused' | 'makeup';
export type ScheduleEditScope = 'single' | 'future' | 'all';
export type ScheduleConflictKind = 'class' | 'instructor' | 'classroom';
export type ScheduleEntryKind = 'recurring' | 'single';
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'cancelled' | 'refunded';
export type PayrollStatus = 'pending' | 'paid' | 'cancelled';
export type WithholdingType = 'none' | 'freelance_3.3' | 'custom';
export type StudentStatus = 'active' | 'inactive' | 'on_leave' | 'graduated' | 'dropped';
export type StaffRole = 'admin' | 'teacher' | 'instructor' | 'staff';
export type StaffStatus = 'active' | 'inactive' | 'on_leave';
export type ClassStatus = 'active' | 'inactive' | 'archived';
export type LessonOccurrenceStatus = 'normal' | 'cancelled' | 'makeup' | 'substitute';
export type StudentLearningPeriod = '30d' | '90d' | '180d' | 'all';
export type StudentLearningStatus = 'insufficient' | 'weak' | 'watch' | 'ok';
export type StudentAssignmentProgressStatus = 'not_started' | 'in_progress' | 'completed';
export type StudentLearningAttentionStatus = 'support_needed' | 'check_needed' | 'steady' | 'no_data';
export type StudentLearningPathState = 'configured' | 'needs_setup';
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
  /** Normalized subject fields are optional while legacy academies are migrated. */
  subjectId?: string | null;
  subjectName?: string | null;
  targetGrades?: string[];
  primaryTargetGrade?: string | null;
  active: boolean;
  status: string;
  color: string | null;
  capacity: number | null;
  defaultInstructorId: string | null;
  instructorIds?: string[];
  instructors?: Array<{ id: string; name: string }>;
  defaultClassroomId: string | null;
  courseId?: string | null;
  courseTitle: string | null;
  instructorName: string | null;
  classroomName: string | null;
  studentCount: number;
  weakTypeCount: number;
  avgTypeScore: number | null;
  lastLearningAt: string | null;
  notes?: string | null;
}

export interface ClassDirectoryFacetOption {
  value: string;
  label: string;
  count: number;
}

export interface ClassCourseOption {
  id: string;
  title: string;
  subjectId: string | null;
  status: string;
}

export interface ClassDirectoryFacets {
  grades: ClassDirectoryFacetOption[];
  subjects: ClassDirectoryFacetOption[];
  instructors: ClassDirectoryFacetOption[];
  statuses: ClassDirectoryFacetOption[];
}

export interface ClassDirectoryPage {
  classes: ClassSummary[];
  facets: ClassDirectoryFacets;
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
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
  nextCursor: string | null;
  hasMore: boolean;
}

export type StudentDetailSection = 'learning' | 'attendance' | 'billing' | 'management' | 'full';

export interface StudentLearningMetric {
  studentId: string;
  weakTypeCount: number;
  avgTypeScore: number | null;
  lastLearningAt: string | null;
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
  classId: string | null;
  personal: boolean;
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
  correctedProblemCount: number;
  dueSoon: boolean;
  overdue: boolean;
  lastActivityAt: string | null;
}

export interface StudentLearningOverview {
  subjects: StudentLearningSubjectSummary[];
  personalAssignments: StudentAssignmentInsight[];
  unclassifiedAttemptCount: number;
}

export interface StudentLearningSubjectSummary {
  subjectId: string | null;
  subjectName: string;
  status: StudentLearningAttentionStatus;
  sampleCount: number;
  correctCount: number;
  correctRate: number | null;
  correctedProblemCount: number;
  pendingAssignmentCount: number;
  dueSoonAssignmentCount: number;
  classes: StudentLearningClassSummary[];
}

export interface StudentLearningClassSummary {
  classId: string;
  className: string;
  color: string | null;
  courseTitle: string | null;
  subjectId: string | null;
  subjectName: string;
  pathState: StudentLearningPathState;
  primaryPathName: string | null;
  activePathCount: number;
  status: StudentLearningAttentionStatus;
  sampleCount: number;
  correctCount: number;
  correctRate: number | null;
  correctedProblemCount: number;
  pendingAssignmentCount: number;
  dueSoonAssignmentCount: number;
  lastLearningAt: string | null;
}

export interface StudentLearningPathSummary {
  id: string;
  name: string;
  purpose: 'current' | 'advance' | 'review' | 'other';
  role: 'primary' | 'secondary';
  status: 'draft' | 'active' | 'completed' | 'archived';
}

export interface StudentLearningUnitSummary {
  unitId: string | null;
  unitName: string;
  bookId: string | null;
  bookTitle: string | null;
  sampleCount: number;
  correctCount: number;
  correctRate: number | null;
  correctedProblemCount: number;
  status: StudentLearningStatus;
  lastAttemptedAt: string | null;
}

export interface StudentLearningClassContext {
  classId: string;
  pathState: StudentLearningPathState;
  paths: StudentLearningPathSummary[];
  units: StudentLearningUnitSummary[];
  assignments: StudentAssignmentInsight[];
}

export interface StudentLearningTypeSummary {
  typeId: string | null;
  typeName: string;
  sampleCount: number;
  correctCount: number;
  correctRate: number | null;
  correctedProblemCount: number;
  status: StudentLearningStatus;
  lastAttemptedAt: string | null;
}

export interface StudentLearningUnitDetail {
  classId: string;
  unitId: string | null;
  unitName: string;
  types: StudentLearningTypeSummary[];
}

export interface StudentLearningEvidenceRow {
  id: string;
  problemId: string;
  problemLabel: string;
  assignmentId: string | null;
  assignmentTitle: string | null;
  classId: string | null;
  className: string | null;
  bookTitle: string | null;
  firstCorrect: boolean;
  corrected: boolean;
  firstAttemptedAt: string;
  lastAttemptedAt: string;
}

export interface StudentLearningTypeEvidence {
  typeId: string | null;
  typeName: string;
  evidence: StudentLearningEvidenceRow[];
}

export interface StudentAiProblemSummary {
  problemId: string | null;
  problemLabel: string;
  unitName: string | null;
  typeName: string | null;
  conversationCount: number;
  lastConversationAt: string;
  conversations: StudentAiConversationSummary[];
}

export interface StudentAssignmentLearningDetail {
  assignment: StudentAssignmentInsight;
  aiProblems: StudentAiProblemSummary[];
}

export interface StudentAttendanceSummary {
  present: number;
  late: number;
  absent: number;
  excused: number;
  makeup: number;
  total: number;
}

export interface StudentAiConversationSummary {
  id: string;
  assignmentId: string | null;
  assignmentTitle: string | null;
  problemId: string | null;
  problemLabel: string | null;
  unitName: string | null;
  typeName: string | null;
  linkStatus: 'linked' | 'needs_review';
  title: string | null;
  status: string;
  sourceApp: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface StudentAiConversationDetail extends StudentAiConversationSummary {
  messages: StudentAiMessageRow[];
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

export interface StudentGradeAppAccount {
  loginId: string | null;
  status: string;
}

export interface StudentDetail {
  summary: StudentSummary;
  permissions: StudentOperationsPermissions;
  loadedSections: StudentDetailSection[];
  signupInvitation: StudentSignupInvitation | null;
  hasGradeAppAccount: boolean;
  gradeAppAccount: StudentGradeAppAccount | null;
  learningOverview: StudentLearningOverview | null;
  attendanceSummary: StudentAttendanceSummary;
  recentAttendance: AttendanceRow[];
  billing: BillingRow | null;
  recentPayments: PaymentRow[];
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
  hireDate?: string | null;
  qualifications?: string | null;
  notes?: string | null;
  classIds?: string[];
  classNames?: string[];
  activeClassCount?: number;
  upcomingLessonCount?: number;
  lastPaymentDate?: string | null;
  visibleToPeerOnly?: boolean;
}

export interface StaffOperationsPermissions {
  canCreate: boolean;
  canEdit: boolean;
  canArchive: boolean;
  canHardDelete: boolean;
  canViewPayroll: boolean;
  canCreatePayroll: boolean;
  canViewAccount: boolean;
  canViewSensitiveProfile: boolean;
  scopedToPeerClasses: boolean;
}

export interface StaffOperationsOverview {
  staff: StaffSummary[];
  classes: ClassSummary[];
  permissions: StaffOperationsPermissions;
  nextCursor: string | null;
  hasMore: boolean;
}

export type StaffDetailSection = 'profile' | 'classes' | 'payroll' | 'account' | 'management' | 'full';

export interface StaffAccountState {
  hasAccount: boolean;
  accountStatus: string | null;
  membershipRole: StaffRole | 'owner' | null;
  membershipActive: boolean;
  pendingInvitation: boolean;
  invitationExpiresAt: string | null;
  signupInvitation: StaffSignupInvitation | null;
}

export interface StaffPayrollSummary {
  serviceMonth: string;
  grossAmount: number;
  netAmount: number;
  paidCount: number;
  lastPaymentDate: string | null;
}

export interface StaffHardDeleteBlocker {
  key: string;
  label: string;
  count: number;
}

export interface StaffHardDeletePreview {
  staffId: string;
  staffName: string;
  canHardDelete: boolean;
  historicalRecordCount: number;
  sharedIdentityCount: number;
  blockers: StaffHardDeleteBlocker[];
}

export interface StaffDetail {
  summary: StaffSummary;
  permissions: StaffOperationsPermissions;
  loadedSections: StaffDetailSection[];
  assignedClasses: ClassSummary[];
  schedule: ScheduleItem[];
  payroll: InstructorPaymentRow[];
  payrollSummary: StaffPayrollSummary | null;
  account: StaffAccountState | null;
  hardDeletePreview: StaffHardDeletePreview | null;
}

export interface StaffMutationTableSummary {
  schema: string;
  table: string;
  operation: string;
  affectedRows: number;
}

export interface StaffMutationResult {
  staffId: string;
  staffName: string;
  tables: StaffMutationTableSummary[];
  totalAffectedRows: number;
}

export interface StaffSignupInvitation {
  id?: string;
  inviteCode: string;
  expiresAt: string;
  loginHint: string | null;
}

export interface CreateStaffResult {
  staffId: string;
  staffName: string;
  invitation: StaffSignupInvitation;
}

export interface ClassroomSummary {
  id: string;
  name: string;
  capacity: number | null;
  color: string | null;
  active: boolean;
}

export interface ScheduleParticipant {
  instructorId: string;
  instructorName: string | null;
  participationKind: 'regular' | 'substitute' | 'makeup' | 'assistant';
  payableMinutes: number;
  replacesInstructorId?: string | null;
}

export interface ScheduleItem {
  id: string;
  actualId: string | null;
  virtual: boolean;
  classId: string;
  className: string;
  classColor?: string | null;
  ruleId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  status: LessonOccurrenceStatus;
  hasEnded: boolean;
  classroomId?: string | null;
  classroomOverrideId?: string | null;
  classroomName: string | null;
  instructorId: string | null;
  instructorOverrideId?: string | null;
  instructorName: string | null;
  instructors?: ScheduleParticipant[];
  substituteInstructorId?: string | null;
  substituteInstructorName?: string | null;
  cancelReason: string | null;
  notes?: string | null;
  overrideScope?: ScheduleEditScope | null;
  updatedAt?: string | null;
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
  intervalWeeks?: number;
  active: boolean;
  classroomId?: string | null;
  classroomName: string | null;
  instructorId: string | null;
  instructorName: string | null;
  instructors?: ScheduleParticipant[];
  updatedAt?: string | null;
}

export interface ScheduleConflict {
  kind: ScheduleConflictKind;
  source: 'rule' | 'occurrence';
  id: string;
  classId: string;
  className: string;
  date: string | null;
  dayOfWeek: number | null;
  startTime: string;
  endTime: string;
  instructorName: string | null;
  classroomName: string | null;
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
  baseAmount: number;
  additionalAmount: number;
  deductionAmount: number;
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

export interface InstructorPayrollRateBreakdown {
  hourlyRate: number;
  minutes: number;
  amount: number;
  effectiveFrom: string | null;
}

export interface InstructorPayrollEstimate {
  instructorId: string;
  instructorName: string;
  hourlyRate: number | null;
  rateBreakdown: InstructorPayrollRateBreakdown[];
  completedLessonCount: number;
  completedMinutes: number;
  scheduledLessonCount: number;
  scheduledMinutes: number;
  estimatedGrossAmount: number;
  paidGrossAmount: number;
  remainingEstimatedAmount: number;
  estimatedBase: number;
  paidBase: number;
  additionalAmount: number;
  deductionAmount: number;
  remainingBase: number;
}

export interface AccountingOperationsOverview {
  billing: BillingRow[];
  payments: PaymentRow[];
  expenses: ExpenseRow[];
  payroll: InstructorPaymentRow[];
  payrollEstimates: InstructorPayrollEstimate[];
  staff: StaffSummary[];
}

export interface StudentPaymentOperationsOverview {
  billing: BillingRow[];
  payments: PaymentRow[];
}

export interface InstructorPayrollOperationsOverview {
  payroll: InstructorPaymentRow[];
  payrollEstimates: InstructorPayrollEstimate[];
  staff: StaffSummary[];
  taxSettings: AccountingTaxSettings;
}

export interface ExpenseOperationsOverview {
  expenses: ExpenseRow[];
}

export interface AccountingTaxSettings {
  payrollIncomeTaxRate: number;
  payrollLocalTaxRate: number;
  salesVatRate: number;
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
  middleUnitName: string | null;
  number: string;
  pagePrinted: number;
  typeName: string | null;
  conceptName: string | null;
}

export interface AssignmentProblemTypeSummary {
  id: string;
  unitId: string | null;
  name: string;
  problemCount: number;
  middleUnitNames?: string[];
}

export interface AssignmentUnitSummary {
  id: string;
  name: string;
  partName: string | null;
  problemCount: number;
  middleUnitNames?: string[];
  unassignedMiddleProblemCount?: number;
}

export interface AssignmentBookCatalogSummary extends BookSummary {
  units: AssignmentUnitSummary[];
  problemTypes: AssignmentProblemTypeSummary[];
}

export type AssignmentStudentProgressStatus = 'not_started' | 'in_progress' | 'completed';

export interface AssignmentOperationsPermissions {
  canCreate: boolean;
  canManageAll: boolean;
  canManageRecipients: boolean;
  canRecall: boolean;
  canDelete: boolean;
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
  studentProgress: AssignmentRecipientProgress[];
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
  books: AssignmentBookCatalogSummary[];
  classes: ClassSummary[];
  students: StudentSummary[];
  permissions: AssignmentOperationsPermissions;
}

export interface AssignmentProblemScope {
  unitId: string;
  problemTypeId: string | null;
  middleUnitName: string | null;
  unassignedMiddleUnit?: boolean;
}

export interface CreateLearningAssignmentInput {
  title: string;
  description?: string | null;
  bookId?: string | null;
  unitIds?: string[];
  problemTypeIds?: string[];
  problemScopes?: AssignmentProblemScope[];
  problemIds?: string[];
  excludedProblemIds?: string[];
  classIds?: string[];
  studentIds?: string[];
  directClassId?: string | null;
  personal?: boolean;
  excludedStudentIds?: string[];
  dueAt?: string | null;
  context?: string | null;
  sourceType?: 'content_scope' | 'worksheet';
  learningAnalysisActions?: Array<{
    actionId: string;
    studentId: string;
    skillId: string;
  }>;
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
  joinedAt?: string | null;
  primaryClass?: boolean;
}

export interface ClassMemberCandidate {
  studentId: string;
  personId: string;
  name: string;
  grade: string | null;
  status: StudentStatus;
  classNames: string[];
  billingMode: BillingMode | null;
  hourlyRate: number | null;
  currentRuleType: BillingClassRuleType | null;
  currentRuleAmount: number | null;
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
  updatedAt?: string | null;
}

export interface ClassOperationsOverview {
  classes: ClassSummary[];
  schedule: ScheduleItem[];
  scheduleRules: ScheduleRuleSummary[];
  books: BookSummary[];
  attendance: AttendanceRow[];
  staff: StaffSummary[];
  classrooms: ClassroomSummary[];
  courses?: ClassCourseOption[];
  permissions?: ClassOperationsPermissions;
  truncated: ClassOperationsTruncation;
}

export interface ClassOperationsPermissions {
  canCreateClass: boolean;
  canManageGlobalResources: boolean;
  operatorClassIds: string[];
  occurrenceStatusIds: string[];
}

export interface ClassOperationsTruncation {
  classes: boolean;
  scheduleRules: boolean;
  occurrences: boolean;
  attendance: boolean;
  books: boolean;
  staff: boolean;
  classrooms: boolean;
}

export interface ClassOperationsDetail {
  students: ClassStudentSummary[];
  books: ClassBookSummary[];
}

export interface HomeDashboardSummary {
  date: string;
  todayLessonCount: number;
  todayClassCount: number;
  activeStudentCount: number;
  actionStudentCount: number;
  unpaidBillingCount: number;
}

export interface HomeDashboardLesson {
  id: string;
  actualId: string | null;
  virtual: boolean;
  date: string;
  startTime: string;
  endTime: string;
  status: LessonOccurrenceStatus;
  hasEnded: boolean;
  instructorName: string | null;
  classroomName: string | null;
}

export interface HomeDashboardAssignment {
  id: string;
  title: string;
  dueAt: string | null;
  status: string;
  active: boolean;
  bookTitle: string | null;
  problemCount: number;
  targetStudentCount: number;
  notStartedCount: number;
  inProgressCount: number;
  completedCount: number;
  completionRate: number;
  correctRate: number | null;
  overdue: boolean;
  dueSoon: boolean;
}

export interface HomeDashboardAttendanceSummary {
  totalExpected: number;
  recorded: number;
  missing: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  makeup: number;
}

export interface HomeDashboardWeakType {
  studentId: string;
  studentName: string;
  typeName: string;
  score: number | null;
  status: string;
  lastAttemptedAt: string | null;
}

export interface HomeDashboardActionStudent {
  studentId: string;
  studentName: string;
  classId: string;
  missingAssignmentCount: number;
  weakTypeCount: number;
  attendanceIssueCount: number;
  assignmentTitles: string[];
  weakTypes: HomeDashboardWeakType[];
  attendanceStatuses: string[];
  priorityScore: number;
}

export interface HomeDashboardClassRow {
  classId: string;
  className: string;
  grade: string | null;
  color: string | null;
  instructorName: string | null;
  classroomName: string | null;
  studentCount: number;
  lessons: HomeDashboardLesson[];
  assignmentProgress: {
    assignmentCount: number;
    targetStudentCount: number;
    notStartedCount: number;
    inProgressCount: number;
    completedCount: number;
    completionRate: number;
  };
  assignments: HomeDashboardAssignment[];
  attendance: HomeDashboardAttendanceSummary;
  weakTypeCount: number;
  weakStudentCount: number;
  actionStudents: HomeDashboardActionStudent[];
}

export interface HomeDashboardAdminAlerts {
  unpaidBillingCount: number;
  unpaidBillingAmount: number;
  unpaidBillingStudents: Array<{
    studentId: string;
    studentName: string;
    status: string;
    amount: number;
  }>;
}

export interface HomeDashboardData {
  date: string;
  serviceMonth: string;
  summary: HomeDashboardSummary;
  classes: HomeDashboardClassRow[];
  adminAlerts: HomeDashboardAdminAlerts | null;
}

export type DashboardData = HomeDashboardData;

export interface CreateClassInput {
  name: string;
  grade?: string | null;
  subjectId?: string | null;
  courseId?: string | null;
  targetGrades?: string[];
  instructorIds?: string[];
  capacity?: number | null;
  color?: string | null;
  defaultInstructorId?: string | null;
  defaultClassroomId?: string | null;
  notes?: string | null;
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
  hireDate?: string | null;
  qualifications?: string | null;
  notes?: string | null;
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
  intervalWeeks?: number;
  classroomId?: string | null;
  instructorId?: string | null;
  instructorIds?: string[];
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
  baseAmount?: number;
  additionalAmount?: number;
  deductionAmount?: number;
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

export interface UpsertInstructorPayRateInput {
  instructorId: string;
  effectiveFrom: string;
  hourlyRate: number;
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

export interface BatchAttendanceInput {
  occurrenceId?: string | null;
  classId: string;
  ruleId?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  records: Array<{
    studentId: string;
    status: AttendanceStatus;
    attendedMinutes?: number | null;
    billableMinutes?: number | null;
    notes?: string | null;
  }>;
}

export interface ClassMembershipChangeInput {
  classId: string;
  effectiveDate: string;
  changes: Array<{
    studentId: string;
    action: 'add' | 'remove';
    billingRule?: {
      ruleType: BillingClassRuleType;
      amount: number;
    } | null;
  }>;
}

export interface ScheduleMutationInput {
  kind: ScheduleEntryKind;
  scope: ScheduleEditScope;
  classId: string;
  ruleId?: string | null;
  occurrenceId?: string | null;
  date?: string | null;
  dayOfWeek?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  intervalWeeks?: number;
  startTime: string;
  endTime: string;
  instructorId?: string | null;
  instructorIds?: string[];
  participants?: Array<{
    instructorId: string;
    participationKind?: ScheduleParticipant['participationKind'];
    payableMinutes?: number | null;
    replacesInstructorId?: string | null;
  }>;
  classroomId?: string | null;
  substituteInstructorId?: string | null;
  status?: LessonOccurrenceStatus;
  cancelReason?: string | null;
  notes?: string | null;
  conflictOverrideReason?: string | null;
}

export interface DeleteScheduleInput {
  classId: string;
  ruleId?: string | null;
  occurrenceId?: string | null;
  date: string;
  scope: ScheduleEditScope;
}

export interface UpdateLessonOccurrenceInput {
  occurrenceId?: string | null;
  classId: string;
  ruleId?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  status: LessonOccurrenceStatus;
  instructorId?: string | null;
  instructorIds?: string[];
  participants?: ScheduleMutationInput['participants'];
  classroomId?: string | null;
  substituteInstructorId?: string | null;
  overrideScope?: ScheduleEditScope | null;
  cancelReason?: string | null;
  notes?: string | null;
}
