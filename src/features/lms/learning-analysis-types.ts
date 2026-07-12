export type ChallengeBand = 1 | 2 | 3 | 4;

export type StudyTrackKind = 'current' | 'advance' | 'maintenance';

export type AnalysisPlanKind = StudyTrackKind | 'exam';

export type LearningPathRole = 'primary' | 'supplemental';
export type LearningPathPurpose = 'current' | 'advance' | 'review' | 'exam' | 'other';
export type LearningPathStatus = 'draft' | 'active' | 'completed' | 'archived';

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

export interface LearningAnalysisClassOption {
  id: string;
  name: string;
}

export interface LearningAnalysisStudentOption {
  id: string;
  name: string;
  classIds: string[];
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

export interface LearningPathSummary {
  id: string;
  kind: AnalysisPlanKind;
  role: LearningPathRole;
  purpose: LearningPathPurpose;
  status: LearningPathStatus;
  classId: string;
  className: string;
  name: string;
  targetBand: ChallengeBand;
  maintenanceIntervalDays: 7 | 14 | 21 | 30 | null;
  scopeSkillCount: number;
  materialCount: number;
  dueStudentCount: number;
  actionCount: number;
  units: Array<{
    name: string;
    skillCount: number;
    needsCheckCount: number;
    supportCandidateCount: number;
    contentGapCount: number;
  }>;
  lastEvidenceAt?: string | null;
}

export interface LearningActionQueueItem {
  id: string;
  studentId: string;
  studentName: string;
  className: string;
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
  classId: string;
  className: string;
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
  classes: LearningAnalysisClassOption[];
  students: LearningAnalysisStudentOption[];
  skills: LearningAnalysisSkillOption[];
  materials: LearningAnalysisMaterialOption[];
}

export interface LearningAnalysisData {
  catalog: LearningAnalysisCatalog;
  paths: LearningPathSummary[];
  actionQueue: LearningActionQueueItem[];
  examPlans: ExamPlanSummary[];
  examStudents: StudentExamEvidenceSummary[];
}

export interface CreateLearningPlanInput {
  kind: AnalysisPlanKind;
  role: LearningPathRole;
  classId: string;
  name: string;
  targetBand: ChallengeBand;
  examDate: string | null;
  maintenanceIntervalDays: 7 | 14 | 21 | 30 | null;
  scopeSkillIds: string[];
  materialBookIds: string[];
  studentOverrides: Array<{
    studentId: string;
    included: boolean;
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
  onStartPath?: (pathId: string) => void | Promise<void>;
  onChangePathStatus?: (pathId: string, action: 'complete' | 'archive') => void | Promise<void>;
  onCreateAssignmentDraft?: (actionIds: string[]) => void | Promise<void>;
}
