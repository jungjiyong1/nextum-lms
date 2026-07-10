export type ChallengeBand = 1 | 2 | 3 | 4;

export type StudyTrackKind = 'current' | 'advance' | 'maintenance';

export type AnalysisPlanKind = StudyTrackKind | 'exam';

export type LearningAnalysisTab = 'class-learning' | 'exam-preparation';

export type LearningEvidenceStatus =
  | 'recently_confirmed'
  | 'needs_check'
  | 'support_candidate'
  | 'content_gap';

export type LearningEvidenceOutcome =
  | 'correct'
  | 'incorrect'
  | 'partial'
  | 'unknown'
  | 'blank';

export interface LearningAnalysisClassroomOption {
  id: string;
  name: string;
}

export interface LearningAnalysisStudentOption {
  id: string;
  name: string;
  classroomIds: string[];
}

export interface LearningAnalysisSkillOption {
  id: string;
  name: string;
  unitLabel: string;
}

export interface LearningAnalysisMaterialOption {
  id: string;
  name: string;
  description?: string | null;
}

export interface LearningEvidenceCountSummary {
  scope: number;
  analyzable: number;
  recentlyConfirmed: number;
  needsCheck: number;
  supportCandidate: number;
  contentGap: number;
}

export interface LearningEvidenceEvent {
  id: string;
  problemId: string;
  problemLabel: string;
  skillName: string;
  occurredAt: string;
  sourceLabel: string;
  outcome: LearningEvidenceOutcome;
  included: boolean;
  reason: string;
  challengeBand?: ChallengeBand | null;
  evidenceKindLabel?: string | null;
}

export interface LearningTrackSummary {
  id: string;
  kind: StudyTrackKind;
  classroomId: string;
  classroomName: string;
  name: string;
  targetBand: ChallengeBand;
  maintenanceIntervalDays: 7 | 14 | 21 | 30;
  scopeSkillCount: number;
  materialCount: number;
  dueStudentCount: number;
  actionCount: number;
  lastEvidenceAt?: string | null;
}

export interface LearningActionQueueItem {
  id: string;
  studentId: string;
  studentName: string;
  classroomName: string;
  skillId: string;
  skillName: string;
  status: Extract<LearningEvidenceStatus, 'needs_check' | 'support_candidate'>;
  relatedPlanNames: string[];
  reason: string;
  dueAt?: string | null;
  evidence: LearningEvidenceEvent[];
}

export interface ExamPlanSummary {
  id: string;
  classroomId: string;
  classroomName: string;
  name: string;
  examDate: string;
  targetBand: ChallengeBand;
  summary: LearningEvidenceCountSummary;
}

export interface StudentExamEvidenceSummary {
  studentId: string;
  studentName: string;
  status: LearningEvidenceStatus;
  summary: Omit<LearningEvidenceCountSummary, 'scope'>;
  lastEvidenceAt?: string | null;
  evidence: LearningEvidenceEvent[];
}

export interface LearningAnalysisCatalog {
  classrooms: LearningAnalysisClassroomOption[];
  students: LearningAnalysisStudentOption[];
  skills: LearningAnalysisSkillOption[];
  materials: LearningAnalysisMaterialOption[];
}

export interface LearningAnalysisData {
  catalog: LearningAnalysisCatalog;
  tracks: LearningTrackSummary[];
  actionQueue: LearningActionQueueItem[];
  examPlans: ExamPlanSummary[];
  examStudents: StudentExamEvidenceSummary[];
}

export interface CreateLearningPlanInput {
  kind: AnalysisPlanKind;
  classroomId: string;
  name: string;
  targetBand: ChallengeBand;
  examDate: string | null;
  maintenanceIntervalDays: 7 | 14 | 21 | 30 | null;
  scopeSkillIds: string[];
  materialBookIds: string[];
  studentOverrides: Array<{
    studentId: string;
    targetBand: ChallengeBand;
  }>;
}

export interface LearningAnalysisViewProps {
  data: LearningAnalysisData | null;
  loading: boolean;
  error: string | null;
  initialTab?: LearningAnalysisTab;
  selectedExamPlanId: string | null;
  submittingPlan?: boolean;
  planSubmitError?: string | null;
  onRetry?: () => void;
  onSelectedExamPlanChange: (planId: string) => void;
  onSubmitPlan: (input: CreateLearningPlanInput) => void | Promise<void>;
  onCreateAssignmentDraft?: (actionIds: string[]) => void | Promise<void>;
}
