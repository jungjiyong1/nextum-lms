import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type {
    CreatedPdfAssignmentMatchBatch,
    CreatePdfAssignmentMatchBatchInput,
    FinalizedPdfAssignmentMatchBatch,
    FinalizedPdfAssignmentMatchJob,
    FinalizePdfAssignmentMatchBatchInput,
    FinalizePdfAssignmentMatchJobInput,
    PatchPdfAssignmentMatchJobInput,
    PdfAssignmentMatchBatch,
    PdfAssignmentMatchItem,
    PdfAssignmentMatchJob,
    PdfAssignmentMatchJobStatus,
    PdfAssignmentUploadGrant,
    ResolvePdfAssignmentMatchJobInput,
} from '@/features/lms/pdf-assignment-match-types';
import {
    PDF_ASSIGNMENT_MAX_FILE_BYTES,
    PDF_ASSIGNMENT_MAX_PAGES,
} from '@/features/lms/pdf-assignment-match-types';
import { requiresAssignedClassScope } from '@/core/auth/roles';
import { createAdminClient } from '@/lib/supabase/admin';
import { ASSIGNMENT_FILES_BUCKET } from './assignment-files-storage';
import { mutationError } from './api-response';
import { LmsAuthError, type LmsRoleContext } from './auth';
import { loadAssignedClassIdsForContext } from './class-queries';
import {
    AssignmentMatchError,
    derivePdfAssignmentMatchBatchStatus,
    emptyMatchSummary,
    isValidExternalCode,
    normalizeCodes,
    normalizeCreateMatchBatch,
    normalizeDueAt,
    normalizePageCount,
    normalizeRequestId,
    normalizeRevision,
    normalizeSha256,
    normalizeStoredSummary,
    normalizeStudentId,
    normalizeTitle,
    resolveFinalizeRevision,
    resolveCodeItems,
    type MatchCandidate,
} from './assignment-match-domain';
import { loadAllAssignmentMatchItemsByJob } from './assignment-match-pagination';
import { mapWithConcurrency } from './limited-concurrency';
import { inspectPdfBytes, PdfUploadInspectionError } from './pdf-upload-inspection';
import { isPdfAssignmentMatchEnabled } from './pdf-assignment-match-feature';

type Row = Record<string, any>;
type LmsAdminClient = ReturnType<typeof createAdminClient>;

const PROBLEM_IMAGES_BUCKET = 'problem-images';
const MATH_BANK_KEY = 'nextum_math_bank';
const SOURCE_NAMESPACE = 'studyq';
const BATCH_FINALIZE_CONCURRENCY = 5;
const EDITABLE_JOB_STATUSES: PdfAssignmentMatchJobStatus[] = [
    'upload_pending',
    'uploaded',
    'review_required',
    'ready',
    'failed',
];

function assertPdfAssignmentMatchEnabled(): void {
    if (!isPdfAssignmentMatchEnabled()) {
        throw new AssignmentMatchError(
            'PDF_ASSIGNMENT_MATCH_DISABLED',
            'PDF assignment matching is temporarily disabled.',
            503,
        );
    }
}

function ensureNoError(error: { message?: string } | null, context: string): void {
    if (error) throw new Error(`${context}: ${error.message || 'Unknown Supabase error'}`);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function chunks<T>(values: readonly T[], size = 200): T[][] {
    const result: T[][] = [];
    for (let offset = 0; offset < values.length; offset += size) {
        result.push(values.slice(offset, offset + size));
    }
    return result;
}

function hasOwn(value: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function requestHash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function asObject(value: unknown): Row {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function storageTusEndpoint(): string {
    const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!configuredUrl) throw new Error('Missing Supabase URL for signed PDF upload.');
    const url = new URL(configuredUrl);
    if (url.hostname.endsWith('.supabase.co')) {
        const projectRef = url.hostname.split('.')[0];
        return `${url.protocol}//${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
    }
    return `${url.origin}/storage/v1/upload/resumable`;
}

function matchErrorResponse(error: AssignmentMatchError, request: Request): Response {
    return mutationError(error.code, error.message, {
        request,
        status: error.status,
        fieldErrors: error.fieldErrors,
    });
}

export function assignmentMatchErrorResponse(error: unknown, request: Request): Response | null {
    return error instanceof AssignmentMatchError ? matchErrorResponse(error, request) : null;
}

async function loadMathBank(client: LmsAdminClient, academyId: string): Promise<Row> {
    const { data, error } = await client
        .schema('content')
        .from('books')
        .select('id,academy_id,book_key,metadata')
        .eq('book_key', MATH_BANK_KEY)
        .eq('academy_id', academyId)
        .maybeSingle();
    ensureNoError(error, 'Failed to load the math problem bank');
    const book = data as Row | null;
    const metadata = asObject(book?.metadata);
    if (!book?.id || metadata.visibility !== 'catalog') {
        throw new AssignmentMatchError(
            'MATH_BANK_UNAVAILABLE',
            'The verified math problem bank is not available for assignments.',
            409,
        );
    }
    return book;
}

async function assertActiveTargetStudents(context: LmsRoleContext, studentIds: string[]): Promise<void> {
    const ids = uniqueStrings(studentIds);
    if (ids.length === 0) return;

    const client = createAdminClient();
    const core = client.schema('core');
    const { data, error } = await core
        .from('students')
        .select('id')
        .eq('academy_id', context.academyId)
        .eq('status', 'active')
        .in('id', ids);
    ensureNoError(error, 'Failed to verify PDF assignment students');
    const activeIds = new Set(((data || []) as Row[]).map((row) => String(row.id)));
    if (ids.some((id) => !activeIds.has(id))) {
        throw new AssignmentMatchError(
            'TARGET_STUDENT_UNAVAILABLE',
            'Every target student must be active in this academy.',
        );
    }

    if (!requiresAssignedClassScope(context.role)) return;
    const assignedClassIds = await loadAssignedClassIdsForContext(context);
    if (!assignedClassIds || assignedClassIds.size === 0) {
        throw new LmsAuthError('Only students in assigned classes can receive this PDF assignment.', 403);
    }
    const { data: enrollments, error: enrollmentError } = await core
        .from('class_students')
        .select('student_id')
        .eq('status', 'active')
        .in('class_id', [...assignedClassIds])
        .in('student_id', ids);
    ensureNoError(enrollmentError, 'Failed to verify assigned PDF students');
    const allowedIds = new Set(((enrollments || []) as Row[]).map((row) => String(row.student_id)));
    if (ids.some((id) => !allowedIds.has(id))) {
        throw new LmsAuthError('Only students in assigned classes can receive this PDF assignment.', 403);
    }
}

async function refreshBatchStatus(client: LmsAdminClient, batchId: string, academyId: string): Promise<void> {
    const learning = client.schema('learning');
    const { data, error } = await learning
        .from('assignment_match_jobs')
        .select('status')
        .eq('batch_id', batchId)
        .eq('academy_id', academyId);
    ensureNoError(error, 'Failed to refresh PDF match batch');
    const status = derivePdfAssignmentMatchBatchStatus(
        ((data || []) as Row[]).map((row) => row.status as PdfAssignmentMatchJobStatus),
    );
    const { error: updateError } = await learning
        .from('assignment_match_batches')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', batchId)
        .eq('academy_id', academyId);
    ensureNoError(updateError, 'Failed to update PDF match batch');
}

function itemDto(row: Row): PdfAssignmentMatchItem {
    const metadata = asObject(row.metadata);
    const bbox = row.bbox && typeof row.bbox === 'object' ? row.bbox : null;
    return {
        ordinal: Number(row.ordinal),
        page: Number(row.page_number),
        externalCode: String(row.external_code || metadata.raw_external_code || ''),
        status: row.status,
        problemId: row.problem_id ? String(row.problem_id) : null,
        number: typeof metadata.number === 'string' ? metadata.number : null,
        unitName: typeof metadata.unit_name === 'string' ? metadata.unit_name : null,
        typeName: typeof metadata.type_name === 'string' ? metadata.type_name : null,
        imagePath: typeof metadata.image_path === 'string' ? metadata.image_path : null,
        imageUrl: null,
        bbox,
    };
}

async function loadAssignmentMatchItemRows(
    client: LmsAdminClient,
    jobIds: readonly string[],
): Promise<Row[]> {
    const learning = client.schema('learning');
    return loadAllAssignmentMatchItemsByJob(jobIds, async (jobId, from, to) => {
        const { data, error } = await learning
            .from('assignment_match_items')
            .select('job_id,ordinal,page_number,bbox,external_code,status,problem_id,metadata')
            .eq('job_id', jobId)
            .order('ordinal', { ascending: true })
            .range(from, to);
        ensureNoError(error, 'Failed to load PDF match items');
        return (data || []) as Row[];
    });
}

async function attachProblemImageUrls(
    client: LmsAdminClient,
    items: PdfAssignmentMatchItem[],
): Promise<void> {
    const external = items.filter((item) => item.status === 'matched' && item.imagePath && /^(?:https?:)?\/\//iu.test(item.imagePath));
    for (const item of external) item.imageUrl = item.imagePath;
    const paths = uniqueStrings(items
        .filter((item) => item.status === 'matched' && item.imagePath && !/^(?:https?:)?\/\//iu.test(item.imagePath))
        .map((item) => item.imagePath));
    const signedByPath = new Map<string, string>();
    for (const pathBatch of chunks(paths, 100)) {
        const { data, error } = await client.storage
            .from(PROBLEM_IMAGES_BUCKET)
            .createSignedUrls(pathBatch, 600);
        ensureNoError(error, 'Failed to sign matched problem images');
        for (const entry of data || []) {
            if (entry.path && entry.signedUrl && !entry.error) signedByPath.set(entry.path, entry.signedUrl);
        }
    }
    for (const item of items) {
        if (item.imagePath && signedByPath.has(item.imagePath)) item.imageUrl = signedByPath.get(item.imagePath) || null;
    }
}

function jobDto(row: Row, items: PdfAssignmentMatchItem[]): PdfAssignmentMatchJob {
    return {
        id: String(row.id),
        batchId: String(row.batch_id),
        revision: Number(row.revision),
        fileName: String(row.file_name),
        filePath: String(row.file_path),
        fileSize: Number(row.file_size),
        pageCount: row.page_count === null || row.page_count === undefined ? null : Number(row.page_count),
        targetStudentId: row.target_student_id ? String(row.target_student_id) : null,
        title: String(row.title || ''),
        dueAt: row.due_at ? String(row.due_at) : null,
        status: row.status,
        assignmentId: row.assignment_id ? String(row.assignment_id) : null,
        summary: normalizeStoredSummary(row.summary),
        items,
        error: row.error_message ? String(row.error_message) : null,
    };
}

export async function loadAssignmentMatchBatch(
    context: LmsRoleContext,
    batchId: string,
): Promise<PdfAssignmentMatchBatch> {
    assertPdfAssignmentMatchEnabled();
    if (!batchId) throw new AssignmentMatchError('INVALID_MATCH_BATCH', 'A match batch id is required.');
    const client = createAdminClient();
    const learning = client.schema('learning');
    const { data: batchData, error: batchError } = await learning
        .from('assignment_match_batches')
        .select('id,mode,status,created_by')
        .eq('id', batchId)
        .eq('academy_id', context.academyId)
        .maybeSingle();
    ensureNoError(batchError, 'Failed to load PDF match batch');
    if (!batchData?.id) throw new AssignmentMatchError('MATCH_BATCH_NOT_FOUND', 'The PDF match batch was not found.', 404);
    if (requiresAssignedClassScope(context.role) && batchData.created_by !== context.personId) {
        throw new LmsAuthError('Only PDF match batches created by this instructor are accessible.', 403);
    }

    const { data: jobData, error: jobError } = await learning
        .from('assignment_match_jobs')
        .select('id,batch_id,revision,file_name,file_path,file_size,page_count,target_student_id,title,due_at,status,assignment_id,summary,error_message,sort_order')
        .eq('batch_id', batchId)
        .eq('academy_id', context.academyId)
        .order('sort_order');
    ensureNoError(jobError, 'Failed to load PDF match jobs');
    const jobs = (jobData || []) as Row[];
    return {
        id: String(batchData.id),
        mode: batchData.mode,
        status: batchData.status,
        jobs: jobs.map((row) => jobDto(row, [])),
    };
}

async function loadJobRow(client: LmsAdminClient, context: LmsRoleContext, jobId: string): Promise<Row> {
    const { data, error } = await client
        .schema('learning')
        .from('assignment_match_jobs')
        .select('id,batch_id,academy_id,book_id,revision,file_name,file_path,file_size,page_count,source_pdf_sha256,target_student_id,title,due_at,status,assignment_id,summary,error_message,metadata,created_by')
        .eq('id', jobId)
        .eq('academy_id', context.academyId)
        .maybeSingle();
    ensureNoError(error, 'Failed to load PDF match job');
    if (!data?.id) throw new AssignmentMatchError('MATCH_JOB_NOT_FOUND', 'The PDF match job was not found.', 404);
    if (requiresAssignedClassScope(context.role) && data.created_by !== context.personId) {
        throw new LmsAuthError('Only PDF match jobs created by this instructor are accessible.', 403);
    }
    return data as Row;
}

export async function loadAssignmentMatchJob(
    context: LmsRoleContext,
    jobId: string,
): Promise<PdfAssignmentMatchJob> {
    assertPdfAssignmentMatchEnabled();
    if (!jobId) throw new AssignmentMatchError('INVALID_MATCH_JOB', 'A match job id is required.');
    const client = createAdminClient();
    const job = await loadJobRow(client, context, jobId);
    const itemRows = await loadAssignmentMatchItemRows(client, [jobId]);
    const items = itemRows.map(itemDto);
    await attachProblemImageUrls(client, items);
    return jobDto(job, items);
}

async function loadJobDto(context: LmsRoleContext, job: Row): Promise<PdfAssignmentMatchJob> {
    return loadAssignmentMatchJob(context, String(job.id));
}

async function issueUploadGrant(client: LmsAdminClient, job: { id: string; filePath: string }): Promise<PdfAssignmentUploadGrant> {
    const { data, error } = await client.storage
        .from(ASSIGNMENT_FILES_BUCKET)
        .createSignedUploadUrl(job.filePath, { upsert: false });
    ensureNoError(error, 'Failed to issue a signed PDF upload URL');
    if (!data?.token || !data.signedUrl) throw new Error('Signed PDF upload response is incomplete.');
    return {
        jobId: job.id,
        bucket: ASSIGNMENT_FILES_BUCKET,
        path: job.filePath,
        token: data.token,
        signedUrl: data.signedUrl,
        tusEndpoint: storageTusEndpoint(),
    };
}

async function uploadedObjectExists(client: LmsAdminClient, path: string): Promise<boolean> {
    const separator = path.lastIndexOf('/');
    const folder = path.slice(0, separator);
    const fileName = path.slice(separator + 1);
    const { data, error } = await client.storage
        .from(ASSIGNMENT_FILES_BUCKET)
        .list(folder, { limit: 10, search: fileName });
    ensureNoError(error, 'Failed to inspect pending PDF upload');
    return (data || []).some((candidate) => candidate.name === fileName && candidate.id);
}

async function issuePendingUploadGrants(
    client: LmsAdminClient,
    batch: PdfAssignmentMatchBatch,
): Promise<PdfAssignmentUploadGrant[]> {
    const pending = batch.jobs.filter((job) => job.status === 'upload_pending');
    const grants = await Promise.all(pending.map(async (job) => (
        await uploadedObjectExists(client, job.filePath)
            ? null
            : issueUploadGrant(client, { id: job.id, filePath: job.filePath })
    )));
    return grants.filter((grant): grant is PdfAssignmentUploadGrant => grant !== null);
}

export async function createAssignmentMatchBatch(
    context: LmsRoleContext,
    input: CreatePdfAssignmentMatchBatchInput,
): Promise<CreatedPdfAssignmentMatchBatch> {
    assertPdfAssignmentMatchEnabled();
    const normalized = normalizeCreateMatchBatch(input);
    await assertActiveTargetStudents(
        context,
        normalized.jobs.map((job) => job.targetStudentId).filter((value): value is string => Boolean(value)),
    );

    const client = createAdminClient();
    const learning = client.schema('learning');
    const book = await loadMathBank(client, context.academyId);
    const payloadHash = requestHash(normalized);
    const { data: existing, error: existingError } = await learning
        .from('assignment_match_batches')
        .select('id,metadata')
        .eq('academy_id', context.academyId)
        .eq('idempotency_key', normalized.clientRequestId)
        .maybeSingle();
    ensureNoError(existingError, 'Failed to check PDF match idempotency');
    if (existing?.id) {
        if (asObject(existing.metadata).request_hash !== payloadHash) {
            throw new AssignmentMatchError(
                'IDEMPOTENCY_KEY_REUSED',
                'The client request id has already been used with different PDF jobs.',
                409,
            );
        }
        const batch = await loadAssignmentMatchBatch(context, String(existing.id));
        return { batch, uploads: await issuePendingUploadGrants(client, batch) };
    }

    const batchId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000).toISOString();
    const { error: batchError } = await learning.from('assignment_match_batches').insert({
        id: batchId,
        academy_id: context.academyId,
        mode: normalized.mode,
        status: 'draft',
        idempotency_key: normalized.clientRequestId,
        created_by: context.personId,
        metadata: { request_hash: payloadHash },
    });
    if (batchError) {
        if ((batchError as Row).code === '23505') {
            const { data: raced, error: racedError } = await learning
                .from('assignment_match_batches')
                .select('id,metadata')
                .eq('academy_id', context.academyId)
                .eq('idempotency_key', normalized.clientRequestId)
                .maybeSingle();
            ensureNoError(racedError, 'Failed to recover PDF match idempotency');
            if (raced?.id && asObject(raced.metadata).request_hash === payloadHash) {
                const batch = await loadAssignmentMatchBatch(context, String(raced.id));
                return { batch, uploads: await issuePendingUploadGrants(client, batch) };
            }
        }
        ensureNoError(batchError, 'Failed to create PDF match batch');
    }

    const jobs = normalized.jobs.map((job, index) => {
        const id = randomUUID();
        return {
            id,
            batch_id: batchId,
            academy_id: context.academyId,
            book_id: String(book.id),
            sort_order: index,
            target_student_id: job.targetStudentId,
            file_name: job.fileName,
            file_path: `${context.academyId}/match-jobs/${id}/source.pdf`,
            media_type: 'application/pdf',
            file_size: job.fileSize,
            page_count: null,
            title: job.title,
            description: null,
            context: 'homework',
            due_at: job.dueAt,
            available_from: null,
            status: 'upload_pending',
            revision: 1,
            summary: emptyMatchSummary(),
            metadata: {
                original_target_student_id: job.targetStudentId,
                client_page_count: job.pageCount,
            },
            expires_at: expiresAt,
            created_by: context.personId,
        };
    });

    try {
        const { error: jobsError } = await learning.from('assignment_match_jobs').insert(jobs);
        ensureNoError(jobsError, 'Failed to create PDF match jobs');
        const uploads = await Promise.all(jobs.map((job) => issueUploadGrant(client, {
            id: job.id,
            filePath: job.file_path,
        })));
        return { batch: await loadAssignmentMatchBatch(context, batchId), uploads };
    } catch (error) {
        await learning.from('assignment_match_batches').delete().eq('id', batchId).eq('academy_id', context.academyId);
        throw error;
    }
}

async function loadUploadedPdfObject(client: LmsAdminClient, job: Row): Promise<Row> {
    const path = String(job.file_path);
    const separator = path.lastIndexOf('/');
    const folder = path.slice(0, separator);
    const fileName = path.slice(separator + 1);
    const { data: objects, error: listError } = await client.storage
        .from(ASSIGNMENT_FILES_BUCKET)
        .list(folder, { limit: 10, search: fileName });
    ensureNoError(listError, 'Failed to inspect uploaded PDF');
    const object = (objects || []).find((candidate) => candidate.name === fileName && candidate.id) as Row | undefined;
    if (!object) throw new AssignmentMatchError('PDF_UPLOAD_MISSING', 'Upload the PDF before matching its codes.', 409);
    const metadata = asObject(object.metadata);
    const actualSize = Number(metadata.size);
    if (!Number.isInteger(actualSize) || actualSize < 1 || actualSize > PDF_ASSIGNMENT_MAX_FILE_BYTES || actualSize !== Number(job.file_size)) {
        throw new AssignmentMatchError('PDF_UPLOAD_SIZE_MISMATCH', 'The uploaded PDF size does not match the job.', 409);
    }
    const mediaType = String(metadata.mimetype || metadata.contentType || '').toLowerCase();
    if (mediaType && mediaType !== 'application/pdf') {
        throw new AssignmentMatchError('INVALID_PDF_FILE', 'The uploaded object is not a PDF.', 409);
    }
    return object;
}

function uploadedObjectFingerprint(object: Row): string {
    const metadata = asObject(object.metadata);
    return requestHash({
        id: object.id ?? null,
        updatedAt: object.updated_at ?? null,
        size: metadata.size ?? null,
        etag: metadata.eTag ?? metadata.etag ?? null,
        lastModified: metadata.lastModified ?? metadata.last_modified ?? null,
    });
}

interface AuthoritativePdfInspection {
    sha256: string;
    pageCount: number;
    objectFingerprint: string;
    scannedAnswerInspection: Row;
}

async function readResponseBytes(response: Response, expectedSize: number): Promise<{ bytes: Uint8Array; sha256: string }> {
    const lengthHeader = Number(response.headers.get('content-length'));
    if (Number.isFinite(lengthHeader) && lengthHeader > PDF_ASSIGNMENT_MAX_FILE_BYTES) {
        throw new AssignmentMatchError('PDF_FILE_LIMIT_EXCEEDED', 'The uploaded PDF exceeds the 50 MB limit.', 409);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new AssignmentMatchError('PDF_UPLOAD_UNREADABLE', 'The uploaded PDF could not be read.', 409);
    const bytes = new Uint8Array(expectedSize);
    const hash = createHash('sha256');
    let offset = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            if (!chunk.value || offset + chunk.value.byteLength > expectedSize) {
                throw new AssignmentMatchError('PDF_UPLOAD_SIZE_MISMATCH', 'The uploaded PDF size changed during inspection.', 409);
            }
            bytes.set(chunk.value, offset);
            hash.update(chunk.value);
            offset += chunk.value.byteLength;
        }
    } finally {
        await reader.cancel().catch(() => undefined);
    }
    if (offset !== expectedSize) {
        throw new AssignmentMatchError('PDF_UPLOAD_SIZE_MISMATCH', 'The uploaded PDF size changed during inspection.', 409);
    }
    return { bytes, sha256: hash.digest('hex') };
}

async function inspectUploadedPdf(client: LmsAdminClient, job: Row): Promise<AuthoritativePdfInspection> {
    const object = await loadUploadedPdfObject(client, job);
    const actualSize = Number(asObject(object.metadata).size);
    const path = String(job.file_path);

    const { data: signed, error: signedError } = await client.storage
        .from(ASSIGNMENT_FILES_BUCKET)
        .createSignedUrl(path, 300);
    ensureNoError(signedError, 'Failed to inspect uploaded PDF contents');
    if (!signed?.signedUrl) throw new Error('Could not inspect uploaded PDF contents.');
    let response: Response;
    try {
        response = await fetch(signed.signedUrl, {
            cache: 'no-store',
            signal: AbortSignal.timeout(240_000),
        });
    } catch {
        throw new AssignmentMatchError('PDF_UPLOAD_UNREADABLE', 'The uploaded PDF could not be read in time.', 409);
    }
    if (!response.ok) throw new AssignmentMatchError('PDF_UPLOAD_UNREADABLE', 'The uploaded PDF could not be read.', 409);
    const downloaded = await readResponseBytes(response, actualSize);
    let parsed;
    try {
        parsed = await inspectPdfBytes(downloaded.bytes, PDF_ASSIGNMENT_MAX_PAGES);
    } catch (error) {
        if (error instanceof PdfUploadInspectionError) {
            throw new AssignmentMatchError(error.code, error.message, 409);
        }
        throw error;
    }
    if (parsed.answerAssessment.blocked) {
        throw new AssignmentMatchError(
            'ANSWER_PDF_BLOCKED',
            'The uploaded document appears to be an answer or solution PDF and cannot be assigned to students.',
            409,
        );
    }
    return {
        sha256: downloaded.sha256,
        pageCount: parsed.pageCount,
        objectFingerprint: uploadedObjectFingerprint(object),
        scannedAnswerInspection: parsed.scannedAnswerInspection,
    };
}

async function verifyStoredPdfInspection(client: LmsAdminClient, job: Row): Promise<void> {
    const object = await loadUploadedPdfObject(client, job);
    const stored = asObject(asObject(job.metadata).pdf_inspection);
    const storedSha256 = normalizeSha256(stored.sha256);
    const storedPageCount = Number(stored.page_count);
    const fingerprint = typeof stored.object_fingerprint === 'string' ? stored.object_fingerprint : '';
    const scannedAnswerInspection = asObject(stored.scanned_answer_inspection);
    if (
        !storedSha256
        || storedSha256 !== normalizeSha256(job.source_pdf_sha256)
        || !Number.isInteger(storedPageCount)
        || storedPageCount !== normalizePageCount(job.page_count)
        || !fingerprint
        || fingerprint !== uploadedObjectFingerprint(object)
        || stored.answer_document === true
        || typeof scannedAnswerInspection.performed !== 'boolean'
    ) {
        throw new AssignmentMatchError(
            'PDF_INSPECTION_STALE',
            'The uploaded PDF changed or has not passed authoritative inspection. Resolve its codes again.',
            409,
        );
    }
}

async function loadMatchCandidates(
    client: LmsAdminClient,
    academyId: string,
    externalCodes: string[],
): Promise<Map<string, MatchCandidate | null>> {
    const codes = uniqueStrings(externalCodes.filter(isValidExternalCode));
    const refs: Row[] = [];
    const content = client.schema('content');
    for (const batch of chunks(codes)) {
        const { data, error } = await content
            .from('problem_source_refs')
            .select('external_id,problem_id')
            .eq('academy_id', academyId)
            .eq('source_namespace', SOURCE_NAMESPACE)
            .in('external_id', batch);
        ensureNoError(error, 'Failed to resolve PDF problem codes');
        refs.push(...((data || []) as Row[]));
    }
    const problemIds = uniqueStrings(refs.map((row) => row.problem_id ? String(row.problem_id) : null));
    const problems: Row[] = [];
    for (const batch of chunks(problemIds)) {
        const { data, error } = await content
            .from('problems')
            .select('id,book_id,unit_id,problem_type_id,number,image_path,verified')
            .in('id', batch);
        ensureNoError(error, 'Failed to verify matched PDF problems');
        problems.push(...((data || []) as Row[]));
    }
    const unitIds = uniqueStrings(problems.map((row) => row.unit_id ? String(row.unit_id) : null));
    const typeIds = uniqueStrings(problems.map((row) => row.problem_type_id ? String(row.problem_type_id) : null));
    const [unitResult, typeResult] = await Promise.all([
        unitIds.length > 0
            ? content.from('units').select('id,name').in('id', unitIds)
            : Promise.resolve({ data: [], error: null }),
        typeIds.length > 0
            ? content.from('problem_types').select('id,name').in('id', typeIds)
            : Promise.resolve({ data: [], error: null }),
    ]);
    ensureNoError(unitResult.error, 'Failed to load matched problem units');
    ensureNoError(typeResult.error, 'Failed to load matched problem types');
    const unitNames = new Map(((unitResult.data || []) as Row[]).map((row) => [String(row.id), String(row.name)]));
    const typeNames = new Map(((typeResult.data || []) as Row[]).map((row) => [String(row.id), String(row.name)]));
    const problemById = new Map(problems.map((row) => [String(row.id), row]));
    const result = new Map<string, MatchCandidate | null>();
    for (const ref of refs) {
        const code = String(ref.external_id);
        const problem = problemById.get(String(ref.problem_id));
        if (!problem) {
            result.set(code, null);
            continue;
        }
        result.set(code, {
            problemId: String(problem.id),
            bookId: String(problem.book_id),
            verified: problem.verified === true,
            number: problem.number === null || problem.number === undefined ? null : String(problem.number),
            unitName: problem.unit_id ? unitNames.get(String(problem.unit_id)) || null : null,
            typeName: problem.problem_type_id ? typeNames.get(String(problem.problem_type_id)) || null : null,
            imagePath: problem.image_path ? String(problem.image_path) : null,
        });
    }
    return result;
}

interface ResolvePatch {
    targetStudentId?: string | null;
    title?: string;
    dueAt?: string | null;
}

export async function resolveAssignmentMatchJob(
    context: LmsRoleContext,
    jobId: string,
    input: ResolvePdfAssignmentMatchJobInput,
    patch: ResolvePatch = {},
): Promise<PdfAssignmentMatchJob> {
    assertPdfAssignmentMatchEnabled();
    const revision = normalizeRevision(input.revision);
    const claimedPageCount = normalizePageCount(input.pageCount);
    const client = createAdminClient();
    const learning = client.schema('learning');
    const job = await loadJobRow(client, context, jobId);
    const claimedSha256 = normalizeSha256(input.sourcePdfSha256 ?? job.source_pdf_sha256);
    if (!claimedSha256) {
        throw new AssignmentMatchError('INVALID_PDF_HASH', 'A PDF SHA-256 hash is required before code matching.');
    }
    if (!EDITABLE_JOB_STATUSES.includes(job.status)) {
        throw new AssignmentMatchError('MATCH_JOB_NOT_EDITABLE', 'This PDF match job can no longer be edited.', 409);
    }
    if (Number(job.revision) !== revision) {
        throw new AssignmentMatchError('MATCH_REVISION_CONFLICT', 'The PDF match job changed. Reload it and try again.', 409);
    }
    const targetStudentId = hasOwn(patch, 'targetStudentId')
        ? normalizeStudentId(patch.targetStudentId, false)
        : job.target_student_id ? String(job.target_student_id) : null;
    const title = hasOwn(patch, 'title') ? normalizeTitle(patch.title) : String(job.title);
    const dueAt = hasOwn(patch, 'dueAt') ? normalizeDueAt(patch.dueAt) : job.due_at ? String(job.due_at) : null;
    if (targetStudentId) await assertActiveTargetStudents(context, [targetStudentId]);
    const authoritative = await inspectUploadedPdf(client, job);
    if (claimedSha256 !== authoritative.sha256) {
        throw new AssignmentMatchError(
            'PDF_HASH_MISMATCH',
            'The browser PDF hash does not match the uploaded PDF bytes.',
            409,
        );
    }
    if (claimedPageCount !== authoritative.pageCount) {
        throw new AssignmentMatchError(
            'PDF_PAGE_COUNT_MISMATCH',
            'The browser PDF page count does not match the uploaded PDF.',
            409,
        );
    }
    const previousInspection = asObject(asObject(job.metadata).pdf_inspection);
    if (
        (previousInspection.sha256 && previousInspection.sha256 !== authoritative.sha256)
        || (previousInspection.page_count && Number(previousInspection.page_count) !== authoritative.pageCount)
    ) {
        throw new AssignmentMatchError('PDF_SOURCE_CHANGED', 'The uploaded PDF changed after its first inspection.', 409);
    }
    const pageCount = authoritative.pageCount;
    const sourcePdfSha256 = authoritative.sha256;
    const codes = normalizeCodes(input.codes, pageCount);
    const book = await loadMathBank(client, context.academyId);
    if (String(job.book_id) !== String(book.id)) {
        throw new AssignmentMatchError('MATCH_BANK_MISMATCH', 'The match job is not linked to the current math bank.', 409);
    }
    const candidates = await loadMatchCandidates(client, context.academyId, codes.map((code) => code.externalCode));
    const resolved = resolveCodeItems(codes, candidates, String(book.id));
    const nextRevision = revision + 1;
    const { data: claimed, error: claimError } = await learning
        .from('assignment_match_jobs')
        .update({
            status: 'processing',
            revision: nextRevision,
            page_count: pageCount,
            source_pdf_sha256: sourcePdfSha256,
            target_student_id: targetStudentId,
            title,
            due_at: dueAt,
            metadata: {
                ...asObject(job.metadata),
                pdf_inspection: {
                    sha256: sourcePdfSha256,
                    page_count: pageCount,
                    object_fingerprint: authoritative.objectFingerprint,
                    answer_document: false,
                    scanned_answer_inspection: authoritative.scannedAnswerInspection,
                    inspected_at: new Date().toISOString(),
                },
            },
            error_message: null,
            updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)
        .eq('academy_id', context.academyId)
        .eq('revision', revision)
        .select('id')
        .maybeSingle();
    ensureNoError(claimError, 'Failed to claim PDF match job');
    if (!claimed?.id) {
        throw new AssignmentMatchError('MATCH_REVISION_CONFLICT', 'The PDF match job changed. Reload it and try again.', 409);
    }

    try {
        const itemRows = resolved.items.map((item) => ({
            job_id: jobId,
            ordinal: item.ordinal,
            page_number: item.page,
            bbox: item.bbox || null,
            source_namespace: SOURCE_NAMESPACE,
            external_code: isValidExternalCode(item.externalCode) ? item.externalCode : null,
            status: item.status,
            problem_id: item.problemId,
            match_method: item.status === 'matched' ? 'exact_code' : null,
            metadata: {
                raw_external_code: isValidExternalCode(item.externalCode) ? null : item.externalCode,
                number: item.number,
                unit_name: item.unitName,
                type_name: item.typeName,
                image_path: item.imagePath,
            },
        }));
        const { error: itemError } = await learning
            .from('assignment_match_items')
            .upsert(itemRows, { onConflict: 'job_id,ordinal' });
        ensureNoError(itemError, 'Failed to save PDF match items');
        const { error: staleError } = await learning
            .from('assignment_match_items')
            .delete()
            .eq('job_id', jobId)
            .gt('ordinal', itemRows.length);
        ensureNoError(staleError, 'Failed to remove stale PDF match items');
        const ready = resolved.summary.ready && Boolean(targetStudentId) && Boolean(title);
        const { error: finishError } = await learning
            .from('assignment_match_jobs')
            .update({
                status: ready ? 'ready' : 'review_required',
                summary: resolved.summary,
                error_message: null,
                updated_at: new Date().toISOString(),
            })
            .eq('id', jobId)
            .eq('academy_id', context.academyId)
            .eq('revision', nextRevision);
        ensureNoError(finishError, 'Failed to finish PDF code matching');
    } catch (error) {
        await learning
            .from('assignment_match_jobs')
            .update({ status: 'failed', error_message: 'PDF code matching failed.', updated_at: new Date().toISOString() })
            .eq('id', jobId)
            .eq('academy_id', context.academyId)
            .eq('revision', nextRevision);
        throw error;
    }
    await refreshBatchStatus(client, String(job.batch_id), context.academyId);
    return loadJobDto(context, { ...job, revision: nextRevision });
}

export async function patchAssignmentMatchJob(
    context: LmsRoleContext,
    jobId: string,
    input: PatchPdfAssignmentMatchJobInput,
): Promise<PdfAssignmentMatchJob> {
    assertPdfAssignmentMatchEnabled();
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new AssignmentMatchError('INVALID_MATCH_REQUEST', 'A PDF match update is required.');
    }
    const revision = normalizeRevision(input.revision);
    const client = createAdminClient();
    const job = await loadJobRow(client, context, jobId);
    if (Array.isArray(input.codes)) {
        const pageCount = input.pageCount === undefined
            ? normalizePageCount(job.page_count)
            : normalizePageCount(input.pageCount);
        return resolveAssignmentMatchJob(context, jobId, {
            revision,
            pageCount,
            sourcePdfSha256: input.sourcePdfSha256 ?? job.source_pdf_sha256,
            codes: input.codes,
        }, {
            ...(hasOwn(input, 'targetStudentId') ? { targetStudentId: input.targetStudentId } : {}),
            ...(hasOwn(input, 'title') ? { title: input.title } : {}),
            ...(hasOwn(input, 'dueAt') ? { dueAt: input.dueAt } : {}),
        });
    }
    if (!EDITABLE_JOB_STATUSES.includes(job.status)) {
        throw new AssignmentMatchError('MATCH_JOB_NOT_EDITABLE', 'This PDF match job can no longer be edited.', 409);
    }
    if (Number(job.revision) !== revision) {
        throw new AssignmentMatchError('MATCH_REVISION_CONFLICT', 'The PDF match job changed. Reload it and try again.', 409);
    }
    const { data: batch, error: batchError } = await client
        .schema('learning')
        .from('assignment_match_batches')
        .select('mode')
        .eq('id', job.batch_id)
        .eq('academy_id', context.academyId)
        .maybeSingle();
    ensureNoError(batchError, 'Failed to load PDF match batch');
    const targetStudentId = hasOwn(input, 'targetStudentId')
        ? normalizeStudentId(input.targetStudentId, batch?.mode === 'single')
        : job.target_student_id ? String(job.target_student_id) : null;
    const title = hasOwn(input, 'title') ? normalizeTitle(input.title) : String(job.title);
    const dueAt = hasOwn(input, 'dueAt') ? normalizeDueAt(input.dueAt) : job.due_at ? String(job.due_at) : null;
    if (targetStudentId) await assertActiveTargetStudents(context, [targetStudentId]);
    const summary = normalizeStoredSummary(job.summary);
    const status = summary.ready && targetStudentId && title ? 'ready' : summary.total > 0 ? 'review_required' : 'upload_pending';
    const { data: updated, error } = await client
        .schema('learning')
        .from('assignment_match_jobs')
        .update({
            target_student_id: targetStudentId,
            title,
            due_at: dueAt,
            status,
            revision: revision + 1,
            error_message: null,
            updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)
        .eq('academy_id', context.academyId)
        .eq('revision', revision)
        .select('id')
        .maybeSingle();
    ensureNoError(error, 'Failed to update PDF match job');
    if (!updated?.id) {
        throw new AssignmentMatchError('MATCH_REVISION_CONFLICT', 'The PDF match job changed. Reload it and try again.', 409);
    }
    await refreshBatchStatus(client, String(job.batch_id), context.academyId);
    return loadJobDto(context, { ...job, revision: revision + 1 });
}

export async function finalizeAssignmentMatchJob(
    context: LmsRoleContext,
    jobId: string,
    input: FinalizePdfAssignmentMatchJobInput,
    options: { refreshBatch?: boolean } = {},
): Promise<FinalizedPdfAssignmentMatchJob> {
    assertPdfAssignmentMatchEnabled();
    const requestedRevision = normalizeRevision(input.revision);
    const idempotencyKey = normalizeRequestId(input.idempotencyKey, 'idempotencyKey');
    const client = createAdminClient();
    const job = await loadJobRow(client, context, jobId);
    if (job.status !== 'ready' && job.status !== 'assigned') {
        throw new AssignmentMatchError('MATCH_JOB_NOT_READY', 'Resolve every PDF code before assigning this job.', 409);
    }
    const revision = resolveFinalizeRevision(job.status, job.revision, requestedRevision);
    if (job.status !== 'assigned') {
        const studentId = normalizeStudentId(job.target_student_id, true);
        await assertActiveTargetStudents(context, [studentId as string]);
        await verifyStoredPdfInspection(client, job);
    }
    const { data, error } = await client.schema('learning').rpc('create_assignment_from_code_match_v1', {
        p_academy_id: context.academyId,
        p_job_id: jobId,
        p_expected_revision: revision,
        p_idempotency_key: idempotencyKey,
        p_actor_person_id: context.personId,
    });
    if (error) {
        console.error('[PDF assignment match] Finalize RPC failed:', error);
        throw new AssignmentMatchError('MATCH_FINALIZE_FAILED', 'The PDF assignment could not be finalized.', 409);
    }
    const row = (Array.isArray(data) ? data[0] : data) as Row | null;
    if (!row?.assignment_id) throw new Error('PDF assignment finalize RPC returned no assignment id.');
    if (options.refreshBatch !== false) {
        await refreshBatchStatus(client, String(job.batch_id), context.academyId);
    }
    return {
        jobId,
        assignmentId: String(row.assignment_id),
        revision: Number(row.job_revision || revision),
        itemCount: Number(row.item_count || 0),
        recipientCount: Number(row.recipient_count || 0),
        mutationId: row.mutation_id ? String(row.mutation_id) : null,
    };
}

export async function finalizeAssignmentMatchBatch(
    context: LmsRoleContext,
    batchId: string,
    input: FinalizePdfAssignmentMatchBatchInput,
): Promise<FinalizedPdfAssignmentMatchBatch> {
    assertPdfAssignmentMatchEnabled();
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new AssignmentMatchError('INVALID_MATCH_REQUEST', 'A batch finalize request is required.');
    }
    const idempotencyKey = normalizeRequestId(input.idempotencyKey, 'idempotencyKey');
    const batch = await loadAssignmentMatchBatch(context, batchId);
    let selected: Array<{ jobId: string; revision: number }>;
    if (input.jobs !== undefined) {
        if (!Array.isArray(input.jobs) || input.jobs.length < 1 || input.jobs.length > 50) {
            throw new AssignmentMatchError('INVALID_MATCH_JOB_COUNT', 'Select between 1 and 50 PDF jobs to finalize.');
        }
        selected = input.jobs.map((entry) => ({
            jobId: typeof entry?.jobId === 'string' ? entry.jobId : '',
            revision: normalizeRevision(entry?.revision),
        }));
        if (selected.some((entry) => !batch.jobs.some((job) => job.id === entry.jobId))) {
            throw new AssignmentMatchError('MATCH_JOB_NOT_FOUND', 'A selected job does not belong to this batch.', 404);
        }
        if (new Set(selected.map((entry) => entry.jobId)).size !== selected.length) {
            throw new AssignmentMatchError('DUPLICATE_MATCH_JOB', 'A PDF job can only be finalized once per request.');
        }
    } else {
        selected = batch.jobs
            .filter((job) => job.status === 'ready' || job.status === 'assigned')
            .map((job) => ({ jobId: job.id, revision: job.revision }));
    }
    if (selected.length === 0) {
        throw new AssignmentMatchError('MATCH_JOB_NOT_READY', 'This batch has no ready PDF jobs.', 409);
    }

    const results = await mapWithConcurrency(selected, BATCH_FINALIZE_CONCURRENCY, async (selectedJob) => {
        const jobKey = requestHash(`${idempotencyKey}:${selectedJob.jobId}`);
        try {
            const value = await finalizeAssignmentMatchJob(context, selectedJob.jobId, {
                revision: selectedJob.revision,
                idempotencyKey: jobKey,
            }, { refreshBatch: false });
            return { ok: true as const, value };
        } catch (error) {
            return { ok: false as const, value: {
                jobId: selectedJob.jobId,
                code: error instanceof AssignmentMatchError ? error.code : 'MATCH_FINALIZE_FAILED',
                message: error instanceof AssignmentMatchError ? error.message : 'The PDF assignment could not be finalized.',
            } };
        }
    });
    const succeeded: FinalizedPdfAssignmentMatchJob[] = [];
    const failed: FinalizedPdfAssignmentMatchBatch['failed'] = [];
    for (const result of results) {
        if (result.ok) succeeded.push(result.value);
        else failed.push(result.value);
    }
    const client = createAdminClient();
    await refreshBatchStatus(client, batchId, context.academyId);
    return { batchId, succeeded, failed };
}
