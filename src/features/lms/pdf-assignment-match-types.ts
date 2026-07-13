export const PDF_ASSIGNMENT_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const PDF_ASSIGNMENT_MAX_PAGES = 200;
export const PDF_ASSIGNMENT_MAX_CODES = 1_000;
export const PDF_ASSIGNMENT_MAX_BATCH_JOBS = 50;

export type PdfAssignmentMatchMode = 'single' | 'batch';

export type PdfAssignmentMatchBatchStatus =
  | 'draft'
  | 'processing'
  | 'review_required'
  | 'ready'
  | 'partially_assigned'
  | 'assigned'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type PdfAssignmentMatchJobStatus =
  | 'upload_pending'
  | 'uploaded'
  | 'processing'
  | 'review_required'
  | 'ready'
  | 'publishing'
  | 'assigned'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type PdfAssignmentMatchItemStatus =
  | 'matched'
  | 'unknown'
  | 'duplicate'
  | 'unverified'
  | 'blocked'
  | 'invalid';

export interface PdfAssignmentBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfAssignmentCodeInput {
  externalCode: string;
  page: number;
  bbox?: PdfAssignmentBoundingBox | null;
}

export interface PdfAssignmentMatchSummary {
  total: number;
  matched: number;
  unknown: number;
  duplicate: number;
  unverified: number;
  blocked: number;
  invalid: number;
  ready: boolean;
}

export interface PdfAssignmentMatchItem {
  ordinal: number;
  page: number;
  externalCode: string;
  status: PdfAssignmentMatchItemStatus;
  problemId: string | null;
  number: string | null;
  unitName: string | null;
  typeName: string | null;
  imagePath: string | null;
  imageUrl: string | null;
  bbox?: PdfAssignmentBoundingBox | null;
}

export interface PdfAssignmentMatchJob {
  id: string;
  batchId: string;
  revision: number;
  fileName: string;
  filePath: string;
  fileSize: number;
  pageCount: number | null;
  targetStudentId: string | null;
  title: string;
  dueAt: string | null;
  status: PdfAssignmentMatchJobStatus;
  assignmentId: string | null;
  summary: PdfAssignmentMatchSummary;
  items: PdfAssignmentMatchItem[];
  error: string | null;
}

export interface PdfAssignmentMatchBatch {
  id: string;
  mode: PdfAssignmentMatchMode;
  status: PdfAssignmentMatchBatchStatus;
  jobs: PdfAssignmentMatchJob[];
}

export interface PdfAssignmentUploadGrant {
  jobId: string;
  bucket: string;
  path: string;
  token: string;
  signedUrl: string;
  tusEndpoint: string;
}

export interface CreatedPdfAssignmentMatchBatch {
  batch: PdfAssignmentMatchBatch;
  uploads: PdfAssignmentUploadGrant[];
}

export interface CreatePdfAssignmentMatchJobInput {
  fileName: string;
  fileSize: number;
  pageCount?: number | null;
  targetStudentId?: string | null;
  title: string;
  dueAt?: string | null;
}

export interface CreatePdfAssignmentMatchBatchInput {
  mode: PdfAssignmentMatchMode;
  clientRequestId: string;
  jobs: CreatePdfAssignmentMatchJobInput[];
}

export interface ResolvePdfAssignmentMatchJobInput {
  revision: number;
  pageCount: number;
  sourcePdfSha256?: string | null;
  codes: PdfAssignmentCodeInput[];
}

export interface PatchPdfAssignmentMatchJobInput {
  revision: number;
  targetStudentId?: string | null;
  title?: string;
  dueAt?: string | null;
  pageCount?: number;
  sourcePdfSha256?: string | null;
  codes?: PdfAssignmentCodeInput[];
}

export interface FinalizePdfAssignmentMatchJobInput {
  revision: number;
  idempotencyKey: string;
}

export interface FinalizedPdfAssignmentMatchJob {
  jobId: string;
  assignmentId: string;
  revision: number;
  itemCount: number;
  recipientCount: number;
  mutationId: string | null;
}

export interface FinalizePdfAssignmentMatchBatchInput {
  idempotencyKey: string;
  jobs?: Array<{ jobId: string; revision: number }>;
}

export interface FinalizedPdfAssignmentMatchBatch {
  batchId: string;
  succeeded: FinalizedPdfAssignmentMatchJob[];
  failed: Array<{ jobId: string; code: string; message: string }>;
}
