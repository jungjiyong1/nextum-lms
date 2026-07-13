import type {
    CreatePdfAssignmentMatchBatchInput,
    CreatePdfAssignmentMatchJobInput,
    PdfAssignmentBoundingBox,
    PdfAssignmentCodeInput,
    PdfAssignmentMatchItem,
    PdfAssignmentMatchItemStatus,
    PdfAssignmentMatchBatchStatus,
    PdfAssignmentMatchJobStatus,
    PdfAssignmentMatchMode,
    PdfAssignmentMatchSummary,
} from '@/features/lms/pdf-assignment-match-types';
import {
    PDF_ASSIGNMENT_MAX_BATCH_JOBS,
    PDF_ASSIGNMENT_MAX_CODES,
    PDF_ASSIGNMENT_MAX_FILE_BYTES,
    PDF_ASSIGNMENT_MAX_PAGES,
} from '@/features/lms/pdf-assignment-match-types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EXTERNAL_CODE_PATTERN = /^\d{7}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/iu;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const ANSWER_FILE_PATTERN = /(?:정답|해설|답지|answer(?:s)?|solution(?:s)?)/iu;

export class AssignmentMatchError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly status: 400 | 404 | 409 | 503 = 400,
        public readonly fieldErrors?: Record<string, string[]>,
    ) {
        super(message);
        this.name = 'AssignmentMatchError';
    }
}

export interface NormalizedCreateMatchJob {
    fileName: string;
    fileSize: number;
    pageCount: number | null;
    targetStudentId: string | null;
    title: string;
    dueAt: string | null;
}

export interface NormalizedCreateMatchBatch {
    mode: PdfAssignmentMatchMode;
    clientRequestId: string;
    jobs: NormalizedCreateMatchJob[];
}

export interface NormalizedCodeInput {
    externalCode: string;
    page: number;
    bbox: PdfAssignmentBoundingBox | null;
}

export interface MatchCandidate {
    problemId: string;
    bookId: string;
    verified: boolean;
    number: string | null;
    unitName: string | null;
    typeName: string | null;
    imagePath: string | null;
}

export function derivePdfAssignmentMatchBatchStatus(
    statuses: readonly PdfAssignmentMatchJobStatus[],
): PdfAssignmentMatchBatchStatus {
    if (statuses.length === 0) return 'draft';
    if (statuses.every((status) => status === 'assigned')) return 'assigned';
    if (statuses.some((status) => status === 'assigned')) return 'partially_assigned';
    if (statuses.some((status) => status === 'processing' || status === 'publishing')) return 'processing';
    if (statuses.every((status) => status === 'ready')) return 'ready';
    if (statuses.every((status) => status === 'expired' || status === 'cancelled')) {
        return statuses.some((status) => status === 'expired') ? 'expired' : 'cancelled';
    }
    if (statuses.every((status) => status === 'failed')) return 'failed';
    if (statuses.some((status) => status === 'review_required' || status === 'failed' || status === 'ready')) {
        return 'review_required';
    }
    return 'draft';
}

function requiredString(value: unknown, field: string, maxLength: number): string {
    if (typeof value !== 'string') {
        throw new AssignmentMatchError('INVALID_MATCH_REQUEST', `${field} is required.`);
    }
    const normalized = value.trim().normalize('NFC');
    if (!normalized || normalized.length > maxLength) {
        throw new AssignmentMatchError('INVALID_MATCH_REQUEST', `${field} is invalid.`);
    }
    return normalized;
}

export function normalizeRequestId(value: unknown, field = 'clientRequestId'): string {
    const normalized = requiredString(value, field, 128);
    if (!SAFE_REQUEST_ID_PATTERN.test(normalized)) {
        throw new AssignmentMatchError('INVALID_IDEMPOTENCY_KEY', `${field} is invalid.`);
    }
    return normalized;
}

export function normalizeRevision(value: unknown): number {
    if (!Number.isInteger(value) || Number(value) < 1) {
        throw new AssignmentMatchError('INVALID_MATCH_REVISION', 'A positive match revision is required.');
    }
    return Number(value);
}

export function resolveFinalizeRevision(
    status: string,
    storedRevisionValue: unknown,
    requestedRevisionValue: unknown,
): number {
    const storedRevision = normalizeRevision(storedRevisionValue);
    const requestedRevision = normalizeRevision(requestedRevisionValue);
    if (status !== 'assigned' && storedRevision !== requestedRevision) {
        throw new AssignmentMatchError(
            'MATCH_REVISION_CONFLICT',
            'The PDF match job changed. Reload it and try again.',
            409,
        );
    }
    return status === 'assigned' ? storedRevision : requestedRevision;
}

export function normalizeStudentId(value: unknown, required: boolean): string | null {
    if (value === null || value === undefined || value === '') {
        if (required) throw new AssignmentMatchError('TARGET_STUDENT_REQUIRED', 'A target student is required.');
        return null;
    }
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
        throw new AssignmentMatchError('INVALID_TARGET_STUDENT', 'The target student id is invalid.');
    }
    return value.toLowerCase();
}

export function normalizeTitle(value: unknown): string {
    return requiredString(value, 'title', 200);
}

export function normalizeDueAt(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') {
        throw new AssignmentMatchError('INVALID_DUE_AT', 'The assignment due date is invalid.');
    }
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
        throw new AssignmentMatchError('INVALID_DUE_AT', 'The assignment due date is invalid.');
    }
    return new Date(timestamp).toISOString();
}

export function normalizePageCount(value: unknown): number {
    if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > PDF_ASSIGNMENT_MAX_PAGES) {
        throw new AssignmentMatchError(
            'PDF_PAGE_LIMIT_EXCEEDED',
            `PDF page count must be between 1 and ${PDF_ASSIGNMENT_MAX_PAGES}.`,
        );
    }
    return Number(value);
}

export function normalizeSha256(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
        throw new AssignmentMatchError('INVALID_PDF_HASH', 'The PDF SHA-256 hash is invalid.');
    }
    return value.toLowerCase();
}

export function normalizePdfFileName(value: unknown): string {
    const fileName = requiredString(value, 'fileName', 255);
    if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('\0') || !fileName.toLowerCase().endsWith('.pdf')) {
        throw new AssignmentMatchError('INVALID_PDF_FILE', 'Only a PDF file name without path segments is allowed.');
    }
    if (ANSWER_FILE_PATTERN.test(fileName)) {
        throw new AssignmentMatchError('ANSWER_PDF_BLOCKED', 'Answer and solution PDFs cannot be attached to students.');
    }
    return fileName;
}

export function normalizePdfFileSize(value: unknown): number {
    if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > PDF_ASSIGNMENT_MAX_FILE_BYTES) {
        throw new AssignmentMatchError(
            'PDF_FILE_LIMIT_EXCEEDED',
            `PDF file size must be between 1 byte and ${PDF_ASSIGNMENT_MAX_FILE_BYTES} bytes.`,
        );
    }
    return Number(value);
}

function normalizeCreateJob(value: unknown, requireStudent: boolean): NormalizedCreateMatchJob {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new AssignmentMatchError('INVALID_MATCH_JOB', 'A PDF match job is invalid.');
    }
    const job = value as Partial<CreatePdfAssignmentMatchJobInput>;
    return {
        fileName: normalizePdfFileName(job.fileName),
        fileSize: normalizePdfFileSize(job.fileSize),
        pageCount: job.pageCount === null || job.pageCount === undefined
            ? null
            : normalizePageCount(job.pageCount),
        targetStudentId: normalizeStudentId(job.targetStudentId, requireStudent),
        title: normalizeTitle(job.title),
        dueAt: normalizeDueAt(job.dueAt),
    };
}

export function normalizeCreateMatchBatch(value: unknown): NormalizedCreateMatchBatch {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new AssignmentMatchError('INVALID_MATCH_REQUEST', 'A PDF match batch request is required.');
    }
    const input = value as Partial<CreatePdfAssignmentMatchBatchInput>;
    if (input.mode !== 'single' && input.mode !== 'batch') {
        throw new AssignmentMatchError('INVALID_MATCH_MODE', 'Match mode must be single or batch.');
    }
    if (!Array.isArray(input.jobs) || input.jobs.length < 1 || input.jobs.length > PDF_ASSIGNMENT_MAX_BATCH_JOBS) {
        throw new AssignmentMatchError(
            'INVALID_MATCH_JOB_COUNT',
            `A match batch must contain between 1 and ${PDF_ASSIGNMENT_MAX_BATCH_JOBS} jobs.`,
        );
    }
    if (input.mode === 'single' && input.jobs.length !== 1) {
        throw new AssignmentMatchError('INVALID_MATCH_JOB_COUNT', 'Single mode requires exactly one PDF job.');
    }
    return {
        mode: input.mode,
        clientRequestId: normalizeRequestId(input.clientRequestId),
        jobs: input.jobs.map((job) => normalizeCreateJob(job, input.mode === 'single')),
    };
}

function normalizeBoundingBox(value: unknown): PdfAssignmentBoundingBox | null {
    if (value === null || value === undefined) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new AssignmentMatchError('INVALID_CODE_POSITION', 'A code bounding box is invalid.');
    }
    const bbox = value as Record<string, unknown>;
    const numbers = [bbox.x, bbox.y, bbox.width, bbox.height].map(Number);
    if (
        numbers.some((number) => !Number.isFinite(number) || number < 0 || number > 1_000_000)
        || numbers[2] <= 0
        || numbers[3] <= 0
    ) {
        throw new AssignmentMatchError('INVALID_CODE_POSITION', 'A code bounding box is invalid.');
    }
    return { x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3] };
}

export function normalizeCodes(value: unknown, pageCount: number): NormalizedCodeInput[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > PDF_ASSIGNMENT_MAX_CODES) {
        throw new AssignmentMatchError(
            'INVALID_CODE_COUNT',
            `A PDF must contain between 1 and ${PDF_ASSIGNMENT_MAX_CODES} problem codes.`,
        );
    }
    return value.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new AssignmentMatchError('INVALID_CODE_ENTRY', `Problem code ${index + 1} is invalid.`);
        }
        const code = entry as Partial<PdfAssignmentCodeInput>;
        const externalCode = typeof code.externalCode === 'string'
            ? code.externalCode.trim().slice(0, 64)
            : '';
        if (!Number.isInteger(code.page) || Number(code.page) < 1 || Number(code.page) > pageCount) {
            throw new AssignmentMatchError('INVALID_CODE_POSITION', `Problem code ${index + 1} has an invalid page.`);
        }
        return {
            externalCode,
            page: Number(code.page),
            bbox: normalizeBoundingBox(code.bbox),
        };
    });
}

export function isValidExternalCode(value: string): boolean {
    return EXTERNAL_CODE_PATTERN.test(value);
}

export function emptyMatchSummary(): PdfAssignmentMatchSummary {
    return {
        total: 0,
        matched: 0,
        unknown: 0,
        duplicate: 0,
        unverified: 0,
        blocked: 0,
        invalid: 0,
        ready: false,
    };
}

function itemStatus(
    code: NormalizedCodeInput,
    duplicateCodes: Set<string>,
    candidates: ReadonlyMap<string, MatchCandidate | null>,
    expectedBookId: string,
): { status: PdfAssignmentMatchItemStatus; candidate: MatchCandidate | null } {
    if (!isValidExternalCode(code.externalCode)) return { status: 'invalid', candidate: null };
    if (duplicateCodes.has(code.externalCode)) return { status: 'duplicate', candidate: null };
    if (!candidates.has(code.externalCode)) return { status: 'unknown', candidate: null };
    const candidate = candidates.get(code.externalCode) ?? null;
    if (!candidate || candidate.bookId !== expectedBookId) return { status: 'blocked', candidate };
    if (!candidate.verified) return { status: 'unverified', candidate };
    return { status: 'matched', candidate };
}

export function resolveCodeItems(
    codes: NormalizedCodeInput[],
    candidates: ReadonlyMap<string, MatchCandidate | null>,
    expectedBookId: string,
): { items: PdfAssignmentMatchItem[]; summary: PdfAssignmentMatchSummary } {
    const counts = new Map<string, number>();
    for (const code of codes) {
        if (!isValidExternalCode(code.externalCode)) continue;
        counts.set(code.externalCode, (counts.get(code.externalCode) ?? 0) + 1);
    }
    const duplicateCodes = new Set([...counts].filter(([, count]) => count > 1).map(([code]) => code));
    const summary = emptyMatchSummary();
    summary.total = codes.length;

    const items = codes.map((code, index): PdfAssignmentMatchItem => {
        const resolved = itemStatus(code, duplicateCodes, candidates, expectedBookId);
        summary[resolved.status] += 1;
        return {
            ordinal: index + 1,
            page: code.page,
            externalCode: code.externalCode,
            status: resolved.status,
            problemId: resolved.status === 'matched' ? resolved.candidate?.problemId ?? null : null,
            number: resolved.candidate?.number ?? null,
            unitName: resolved.candidate?.unitName ?? null,
            typeName: resolved.candidate?.typeName ?? null,
            imagePath: resolved.candidate?.imagePath ?? null,
            imageUrl: null,
            bbox: code.bbox,
        };
    });
    summary.ready = summary.matched === summary.total && summary.total > 0;
    return { items, summary };
}

export function normalizeStoredSummary(value: unknown): PdfAssignmentMatchSummary {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyMatchSummary();
    const row = value as Record<string, unknown>;
    const summary = emptyMatchSummary();
    for (const key of ['total', 'matched', 'unknown', 'duplicate', 'unverified', 'blocked', 'invalid'] as const) {
        const number = Number(row[key]);
        summary[key] = Number.isInteger(number) && number >= 0 ? number : 0;
    }
    summary.ready = row.ready === true && summary.total > 0 && summary.matched === summary.total;
    return summary;
}
