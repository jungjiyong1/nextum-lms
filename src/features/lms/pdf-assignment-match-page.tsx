'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
    AlertTriangle,
    ArrowLeft,
    CheckCircle2,
    FileSearch,
    FileUp,
    Loader2,
    RefreshCw,
    Send,
    Users,
    X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageShell, PageStatusBar } from '@/components/ui/page-shell';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { extractStudyqCodesFromPdf } from '@/lib/lms/pdf-problem-codes-client';
import { findStudyqExternalCodes, parseManualStudyqCodes } from '@/lib/lms/pdf-problem-codes';
import { uploadToSignedSupabasePath } from '@/lib/lms/signed-tus-upload';
import {
    activeAssignmentMatchBatchId,
    assignmentMatchStorageKey,
    assignmentMatchUrlWithBatchId,
} from '@/lib/lms/assignment-match-resume';
import type {
    CreatedPdfAssignmentMatchBatch,
    PdfAssignmentCodeInput,
    PdfAssignmentMatchBatch,
    PdfAssignmentMatchJob,
    PdfAssignmentMatchMode,
} from './pdf-assignment-match-types';
import {
    PDF_ASSIGNMENT_MAX_BATCH_JOBS,
    PDF_ASSIGNMENT_MAX_CODES,
    PDF_ASSIGNMENT_MAX_FILE_BYTES,
    PDF_ASSIGNMENT_MAX_PAGES,
} from './pdf-assignment-match-types';
import type { AssignmentManagementData, StudentSummary } from './types';
import {
    createPdfAssignmentMatchBatch,
    finalizePdfAssignmentMatchBatch,
    finalizePdfAssignmentMatchJob,
    loadAssignmentManagementData,
    loadPdfAssignmentMatchBatch,
    loadPdfAssignmentMatchJob,
    resolvePdfAssignmentMatchJob,
} from './service';

interface LocalPdfJob {
    localId: string;
    remoteJobId: string | null;
    file: File;
    previewUrl: string;
    targetStudentId: string;
    title: string;
    dueAt: string;
    pageCount: number | null;
    sourcePdfSha256: string | null;
    codes: PdfAssignmentCodeInput[];
    requiresManualCodes: boolean;
    manualCodeDraft: string;
    progress: number;
    error: string | null;
}

const ANSWER_FILE_PATTERN = /(?:정답|해설|답지|answer(?:s)?|solution(?:s)?)/iu;

function academyIdOf(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function newClientId(): string {
    return typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function fileTitle(file: File): string {
    return file.name.replace(/\.pdf$/iu, '').replace(/[_-]+/gu, ' ').trim().slice(0, 200) || '개인 맞춤 과제';
}

function normalizedSearchText(value: string): string {
    return value.normalize('NFC').replace(/\s+/gu, '').toLocaleLowerCase('ko-KR');
}

function suggestedStudent(fileName: string, students: readonly StudentSummary[]): string {
    const haystack = normalizedSearchText(fileName);
    const matches = students.filter((student) => {
        const name = normalizedSearchText(student.name);
        return name.length >= 2 && haystack.includes(name);
    });
    return matches.length === 1 ? matches[0].id : '';
}

function toDueIso(value: string): string | null {
    if (!value) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function bytesLabel(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function sha256Hex(file: File): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function assertPdf(file: File): Promise<void> {
    if (!file.name.toLocaleLowerCase('ko-KR').endsWith('.pdf')) throw new Error('PDF 파일만 업로드할 수 있습니다.');
    if (ANSWER_FILE_PATTERN.test(file.name)) throw new Error('정답·해설 PDF는 학생 과제로 첨부할 수 없습니다.');
    if (file.size < 1 || file.size > PDF_ASSIGNMENT_MAX_FILE_BYTES) {
        throw new Error(`PDF는 ${bytesLabel(PDF_ASSIGNMENT_MAX_FILE_BYTES)} 이하여야 합니다.`);
    }
    const magic = new TextDecoder('ascii').decode(await file.slice(0, 5).arrayBuffer());
    if (magic !== '%PDF-') throw new Error('올바른 PDF 파일이 아닙니다.');
}

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'primary' {
    if (status === 'assigned' || status === 'ready' || status === 'matched') return 'success';
    if (status === 'failed' || status === 'unknown' || status === 'blocked' || status === 'invalid') return 'danger';
    if (status === 'review_required' || status === 'duplicate' || status === 'unverified') return 'warning';
    if (status === 'processing' || status === 'publishing') return 'primary';
    if (status === 'expired') return 'neutral';
    return 'neutral';
}

function statusLabel(status: string): string {
    const labels: Record<string, string> = {
        upload_pending: '업로드 대기',
        uploaded: '업로드 완료',
        processing: '매칭 중',
        review_required: '확인 필요',
        ready: '배정 가능',
        publishing: '배정 중',
        assigned: '배정 완료',
        failed: '실패',
        expired: '만료',
        matched: '일치',
        unknown: '코드 없음',
        duplicate: '중복',
        unverified: '미검증',
        blocked: '사용 불가',
        invalid: '형식 오류',
    };
    return labels[status] || status;
}

function studentLabel(student: StudentSummary): string {
    return [student.name, student.grade, student.classNames.join(', ')].filter(Boolean).join(' · ');
}

export function PdfAssignmentMatchPage() {
    const { profile } = useAuth();
    const academyId = academyIdOf(profile?.current_academy_id);
    const [mode, setMode] = useState<PdfAssignmentMatchMode>('single');
    const [management, setManagement] = useState<AssignmentManagementData | null>(null);
    const [loading, setLoading] = useState(true);
    const [working, setWorking] = useState(false);
    const [rehydratingBatch, setRehydratingBatch] = useState(true);
    const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
    const [resumeError, setResumeError] = useState<string | null>(null);
    const [localJobs, setLocalJobs] = useState<LocalPdfJob[]>([]);
    const [batch, setBatch] = useState<PdfAssignmentMatchBatch | null>(null);
    const [clientRequestId, setClientRequestId] = useState(newClientId);
    const [codeDrafts, setCodeDrafts] = useState<Record<string, string>>({});
    const [selectedReviewJobId, setSelectedReviewJobId] = useState<string | null>(null);
    const localJobsRef = useRef<LocalPdfJob[]>([]);
    const reviewRequestSequence = useRef(0);

    const activeStudents = useMemo(() => (
        (management?.students || [])
            .filter((student) => student.status === 'active')
            .sort((left, right) => left.name.localeCompare(right.name, 'ko-KR'))
    ), [management]);

    const persistActiveBatchId = useCallback((batchId: string | null) => {
        if (!academyId || typeof window === 'undefined') return;
        setActiveBatchId(batchId);
        try {
            const storageKey = assignmentMatchStorageKey(academyId);
            if (batchId) window.localStorage.setItem(storageKey, batchId);
            else window.localStorage.removeItem(storageKey);
        } catch {
            // URL state remains the fallback when browser storage is unavailable.
        }
        window.history.replaceState(
            window.history.state,
            '',
            assignmentMatchUrlWithBatchId(window.location.href, batchId),
        );
    }, [academyId]);

    const loadManagement = useCallback(async () => {
        if (!academyId) return;
        setLoading(true);
        try {
            setManagement(await loadAssignmentManagementData(academyId, { force: true }));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '학생 목록을 불러오지 못했습니다.');
        } finally {
            setLoading(false);
        }
    }, [academyId]);

    useEffect(() => {
        void loadManagement();
    }, [loadManagement]);

    useEffect(() => {
        localJobsRef.current = localJobs;
    }, [localJobs]);

    useEffect(() => () => {
        for (const job of localJobsRef.current) URL.revokeObjectURL(job.previewUrl);
    }, []);

    const reset = () => {
        reviewRequestSequence.current += 1;
        for (const job of localJobs) URL.revokeObjectURL(job.previewUrl);
        setLocalJobs([]);
        setBatch(null);
        setCodeDrafts({});
        setSelectedReviewJobId(null);
        setClientRequestId(newClientId());
        setResumeError(null);
        setRehydratingBatch(false);
        persistActiveBatchId(null);
    };

    const selectFiles = (files: FileList | null) => {
        if (!files || batch || activeBatchId || rehydratingBatch) return;
        const selected = [...files].slice(0, mode === 'single' ? 1 : PDF_ASSIGNMENT_MAX_BATCH_JOBS);
        for (const job of localJobs) URL.revokeObjectURL(job.previewUrl);
        setLocalJobs(selected.map((file) => ({
            localId: newClientId(),
            remoteJobId: null,
            file,
            previewUrl: URL.createObjectURL(file),
            targetStudentId: suggestedStudent(file.name, activeStudents),
            title: fileTitle(file),
            dueAt: '',
            pageCount: null,
            sourcePdfSha256: null,
            codes: [],
            requiresManualCodes: false,
            manualCodeDraft: '',
            progress: 0,
            error: null,
        })));
        setBatch(null);
        setCodeDrafts({});
        setClientRequestId(newClientId());
    };

    const updateLocalJob = (localId: string, patch: Partial<LocalPdfJob>) => {
        setLocalJobs((current) => current.map((job) => job.localId === localId ? { ...job, ...patch } : job));
    };

    const refreshReviewJob = useCallback(async (jobId: string) => {
        if (!academyId) return null;
        const requestSequence = ++reviewRequestSequence.current;
        const detail = await loadPdfAssignmentMatchJob(academyId, jobId, { force: true });
        if (requestSequence !== reviewRequestSequence.current) return null;
        setBatch((current) => current?.id === detail.batchId
            ? { ...current, jobs: current.jobs.map((job) => job.id === detail.id ? detail : job) }
            : current);
        setCodeDrafts((current) => ({
            ...current,
            [detail.id]: detail.items.map((item) => item.externalCode).join('\n'),
        }));
        return detail;
    }, [academyId]);

    const refreshBatch = useCallback(async (batchId: string, preferredReviewJobId?: string | null) => {
        if (!academyId) return null;
        const next = await loadPdfAssignmentMatchBatch(academyId, batchId, { force: true });
        setBatch(next);
        setCodeDrafts((current) => {
            const updated = { ...current };
            for (const job of next.jobs) {
                if (!(job.id in updated)) updated[job.id] = job.items.map((item) => item.externalCode).join('\n');
            }
            return updated;
        });
        const reviewJobId = preferredReviewJobId && next.jobs.some((job) => job.id === preferredReviewJobId)
            ? preferredReviewJobId
            : next.jobs[0]?.id || null;
        setSelectedReviewJobId(reviewJobId);
        if (reviewJobId) {
            await refreshReviewJob(reviewJobId).catch((error) => {
                toast.error(error instanceof Error ? error.message : '문항 미리보기를 불러오지 못했습니다.');
            });
        }
        return next;
    }, [academyId, refreshReviewJob]);

    const resumeActiveBatch = useCallback(async (batchId: string) => {
        setRehydratingBatch(true);
        setResumeError(null);
        try {
            const resumed = await refreshBatch(batchId);
            if (resumed) {
                setMode(resumed.mode);
                persistActiveBatchId(resumed.id);
            }
            return resumed;
        } catch (error) {
            const message = error instanceof Error ? error.message : '기존 PDF 매칭 작업을 불러오지 못했습니다.';
            setResumeError(message);
            throw error;
        } finally {
            setRehydratingBatch(false);
        }
    }, [persistActiveBatchId, refreshBatch]);

    useEffect(() => {
        if (!academyId || typeof window === 'undefined') {
            setRehydratingBatch(false);
            return;
        }
        let storedBatchId: string | null = null;
        try {
            storedBatchId = window.localStorage.getItem(assignmentMatchStorageKey(academyId));
        } catch {
            storedBatchId = null;
        }
        const batchId = activeAssignmentMatchBatchId(window.location.href, storedBatchId);
        if (!batchId) {
            setActiveBatchId(null);
            setRehydratingBatch(false);
            return;
        }
        persistActiveBatchId(batchId);
        void resumeActiveBatch(batchId).catch(() => undefined);
    }, [academyId, persistActiveBatchId, resumeActiveBatch]);

    const prepareAndUpload = async () => {
        if (!academyId || localJobs.length === 0) return;
        if (localJobs.some((job) => !job.targetStudentId)) {
            toast.error('모든 PDF의 대상 학생을 확인하세요.');
            return;
        }
        if (localJobs.some((job) => !job.title.trim())) {
            toast.error('모든 과제명을 입력하세요.');
            return;
        }

        setWorking(true);
        let created: CreatedPdfAssignmentMatchBatch | null = null;
        try {
            const prepared: LocalPdfJob[] = [];
            const manualRequired: string[] = [];
            for (const job of localJobs) {
                updateLocalJob(job.localId, { error: null, progress: 1 });
                try {
                    await assertPdf(job.file);
                    if (job.requiresManualCodes && job.pageCount && job.sourcePdfSha256) {
                        const codes = parseManualStudyqCodes(job.manualCodeDraft, job.pageCount).map((code) => ({
                            externalCode: code.externalCode,
                            page: code.page,
                            bbox: code.bbox,
                        }));
                        const next = { ...job, codes, requiresManualCodes: false, progress: 5, error: null };
                        prepared.push(next);
                        updateLocalJob(job.localId, next);
                        continue;
                    }
                    if (job.pageCount && job.sourcePdfSha256 && job.codes.length > 0) {
                        prepared.push(job);
                        continue;
                    }
                    const extraction = await extractStudyqCodesFromPdf(job.file, {
                        maxPages: PDF_ASSIGNMENT_MAX_PAGES,
                        onProgress: ({ phase, page, pageCount }) => updateLocalJob(job.localId, {
                            progress: phase === 'text'
                                ? Math.max(1, Math.round((page / pageCount) * 2))
                                : Math.max(2, Math.round(2 + (page / pageCount) * 3)),
                        }),
                    });
                    // Hash after PDF.js releases its buffer so a 50 MB file is not held twice.
                    const sourcePdfSha256 = await sha256Hex(job.file);
                    if (extraction.answerAssessment.blocked) {
                        throw new Error('문서 내용이 정답·해설 PDF로 판정되어 학생 과제로 첨부할 수 없습니다.');
                    }
                    if (extraction.codes.length < 1) {
                        const next = {
                            ...job,
                            pageCount: extraction.pageCount,
                            sourcePdfSha256,
                            codes: [],
                            requiresManualCodes: true,
                            progress: 0,
                            error: null,
                        };
                        manualRequired.push(job.file.name);
                        updateLocalJob(job.localId, next);
                        continue;
                    }
                    if (extraction.codes.length > PDF_ASSIGNMENT_MAX_CODES) {
                        throw new Error(`한 PDF에는 최대 ${PDF_ASSIGNMENT_MAX_CODES}문항을 배정할 수 있습니다.`);
                    }
                    const next = {
                        ...job,
                        pageCount: extraction.pageCount,
                        sourcePdfSha256,
                        codes: extraction.codes.map((code) => ({
                            externalCode: code.externalCode,
                            page: code.page,
                            bbox: code.bbox,
                        })),
                        requiresManualCodes: false,
                        progress: 5,
                        error: null,
                    };
                    prepared.push(next);
                    updateLocalJob(job.localId, next);
                } catch (error) {
                    const message = error instanceof Error ? error.message : 'PDF 분석에 실패했습니다.';
                    updateLocalJob(job.localId, { error: message, progress: 0 });
                    throw new Error(`${job.file.name}: ${message}`);
                }
            }

            if (manualRequired.length > 0) {
                toast.warning(`OCR로 코드를 찾지 못한 PDF ${manualRequired.length}개가 있습니다. 페이지와 7자리 코드를 직접 입력한 뒤 다시 진행하세요.`);
                return;
            }
            if (prepared.length !== localJobs.length) return;

            created = await createPdfAssignmentMatchBatch(academyId, {
                mode,
                clientRequestId,
                jobs: prepared.map((job) => ({
                    fileName: job.file.name,
                    fileSize: job.file.size,
                    pageCount: job.pageCount,
                    targetStudentId: job.targetStudentId,
                    title: job.title.trim(),
                    dueAt: toDueIso(job.dueAt),
                })),
            });
            persistActiveBatchId(created.batch.id);
            if (created.batch.jobs.length !== prepared.length) {
                throw new Error('생성된 PDF 매칭 작업 수가 선택한 파일 수와 다릅니다. 새로고침 후 다시 시도하세요.');
            }
            const preparedWithRemoteIds = prepared.map((local, index) => ({
                ...local,
                remoteJobId: created?.batch.jobs[index]?.id || null,
            }));
            if (preparedWithRemoteIds.some((local) => !local.remoteJobId)) {
                throw new Error('생성된 PDF 매칭 작업을 파일과 연결하지 못했습니다.');
            }
            setLocalJobs(preparedWithRemoteIds);
            setBatch(created.batch);

            for (const local of preparedWithRemoteIds) {
                const remote = created.batch.jobs.find((job) => job.id === local.remoteJobId);
                const grant = created.uploads.find((item) => item.jobId === remote?.id);
                if (!remote) throw new Error(`${local.file.name}의 매칭 작업을 찾지 못했습니다.`);
                if (['ready', 'review_required', 'assigned'].includes(remote.status)) continue;

                if (grant) {
                    await uploadToSignedSupabasePath({
                        file: local.file,
                        endpoint: grant.tusEndpoint,
                        bucket: grant.bucket,
                        objectPath: grant.path,
                        uploadToken: grant.token,
                        onProgress: (percentage) => updateLocalJob(local.localId, { progress: percentage }),
                    });
                }
                await resolvePdfAssignmentMatchJob(academyId, remote.id, {
                    revision: remote.revision,
                    pageCount: local.pageCount || 1,
                    sourcePdfSha256: local.sourcePdfSha256,
                    codes: local.codes,
                });
            }

            await refreshBatch(created.batch.id, created.batch.jobs[0]?.id);
            toast.success('PDF 업로드와 문항코드 매칭을 완료했습니다.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'PDF 매칭을 시작하지 못했습니다.');
            if (created) await refreshBatch(created.batch.id, created.batch.jobs[0]?.id).catch(() => undefined);
        } finally {
            setWorking(false);
        }
    };

    const reResolve = async (job: PdfAssignmentMatchJob) => {
        if (!academyId || !job.pageCount) return;
        const codes = findStudyqExternalCodes(codeDrafts[job.id] || '');
        if (codes.length < 1 || codes.length > PDF_ASSIGNMENT_MAX_CODES) {
            toast.error(`7자리 문항코드를 1개 이상 ${PDF_ASSIGNMENT_MAX_CODES}개 이하로 입력하세요.`);
            return;
        }
        setWorking(true);
        try {
            await resolvePdfAssignmentMatchJob(academyId, job.id, {
                revision: job.revision,
                pageCount: job.pageCount,
                codes: codes.map((externalCode, index) => ({
                    externalCode,
                    page: job.items[index]?.page || 1,
                    bbox: job.items[index]?.bbox || null,
                })),
            });
            if (batch) await refreshBatch(batch.id, job.id);
            toast.success('수정한 코드로 다시 매칭했습니다.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '코드 재매칭에 실패했습니다.');
        } finally {
            setWorking(false);
        }
    };

    const finalizeOne = async (job: PdfAssignmentMatchJob) => {
        if (!academyId || !batch) return;
        setWorking(true);
        try {
            await finalizePdfAssignmentMatchJob(academyId, job.id, {
                revision: job.revision,
                idempotencyKey: `pdf-match:${job.id}`,
            });
            await refreshBatch(batch.id, job.id);
            toast.success('학생에게 과제를 배정했습니다.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '과제 배정에 실패했습니다.');
        } finally {
            setWorking(false);
        }
    };

    const finalizeReadyJobs = async () => {
        if (!academyId || !batch) return;
        const readyJobs = batch.jobs.filter((job) => job.status === 'ready');
        if (readyJobs.length === 0) {
            toast.error('배정 가능한 PDF가 없습니다.');
            return;
        }
        setWorking(true);
        try {
            const result = await finalizePdfAssignmentMatchBatch(academyId, batch.id, {
                idempotencyKey: `pdf-match-batch:${batch.id}`,
                jobs: readyJobs.map((job) => ({ jobId: job.id, revision: job.revision })),
            });
            await refreshBatch(batch.id, selectedReviewJobId);
            if (result.failed.length > 0) toast.warning(`${result.succeeded.length}건 성공, ${result.failed.length}건 확인 필요`);
            else toast.success(`${result.succeeded.length}건의 과제를 배정했습니다.`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '일괄 배정에 실패했습니다.');
        } finally {
            setWorking(false);
        }
    };

    const selectedReviewJob = batch?.jobs.find((job) => job.id === selectedReviewJobId) || batch?.jobs[0] || null;
    const selectedLocalJob = selectedReviewJob
        ? localJobs.find((job) => job.remoteJobId === selectedReviewJob.id) || null
        : null;
    const workflowLocked = Boolean(batch || activeBatchId || rehydratingBatch);

    if (!academyId) {
        return <PageShell title="PDF 과제 배정"><PageStatusBar tone="warning">현재 계정에 연결된 학원이 없습니다.</PageStatusBar></PageShell>;
    }

    return (
        <PageShell
            title="학생별 PDF 과제 배정"
            icon={FileSearch}
            actions={(
                <Button asChild variant="outline">
                    <Link href="/assignments/new"><ArrowLeft className="mr-2 h-4 w-4" />과제 관리</Link>
                </Button>
            )}
        >
            <PageStatusBar tone="info">
                PDF에 포함된 7자리 문항코드를 넥섬 수학 문제은행과 정확히 대조한 뒤 학생에게 배정합니다.
            </PageStatusBar>

            <Tabs value={mode} onValueChange={(value) => { reset(); setMode(value as PdfAssignmentMatchMode); }}>
                <TabsList>
                    <TabsTrigger value="single" disabled={workflowLocked}><FileUp className="mr-2 h-4 w-4" />학생 한 명</TabsTrigger>
                    <TabsTrigger value="batch" disabled={workflowLocked}><Users className="mr-2 h-4 w-4" />여러 학생 일괄</TabsTrigger>
                </TabsList>
                <TabsContent value={mode} className="space-y-4">
                    <Card>
                        <CardHeader><CardTitle>{mode === 'single' ? '개인 PDF 선택' : '학생별 PDF 일괄 선택'}</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <Input
                                type="file"
                                accept="application/pdf,.pdf"
                                multiple={mode === 'batch'}
                                disabled={working || loading || workflowLocked}
                                onChange={(event) => selectFiles(event.target.files)}
                            />
                            <p className="text-xs text-muted-foreground">
                                PDF당 최대 {bytesLabel(PDF_ASSIGNMENT_MAX_FILE_BYTES)}, {PDF_ASSIGNMENT_MAX_PAGES}페이지, {PDF_ASSIGNMENT_MAX_CODES}문항
                                {mode === 'batch' ? ` · 한 번에 최대 ${PDF_ASSIGNMENT_MAX_BATCH_JOBS}개` : ''}
                            </p>
                            {batch && (
                                <p className="text-xs text-muted-foreground">
                                    서버 작업이 생성되어 학생·과제명·기한과 파일 구성을 잠갔습니다. 변경하려면 새 작업을 시작하세요.
                                </p>
                            )}
                            {rehydratingBatch && activeBatchId && (
                                <p className="text-xs text-primary">저장된 PDF 매칭 작업을 다시 불러오는 중입니다.</p>
                            )}
                            {resumeError && activeBatchId && !batch && (
                                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3">
                                    <p className="text-sm text-warning-foreground">{resumeError}</p>
                                    <div className="flex gap-2">
                                        <Button type="button" size="sm" variant="outline" disabled={rehydratingBatch} onClick={() => void resumeActiveBatch(activeBatchId).catch(() => undefined)}>
                                            다시 불러오기
                                        </Button>
                                        <Button type="button" size="sm" variant="outline" disabled={rehydratingBatch} onClick={reset}>
                                            새 작업 시작
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {localJobs.map((job) => (
                                <div key={job.localId} className="grid gap-3 rounded-xl border bg-card p-4 lg:grid-cols-[1.1fr_1fr_1fr_auto] lg:items-end">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-foreground">{job.file.name}</p>
                                        <p className="text-xs text-muted-foreground">{bytesLabel(job.file.size)}</p>
                                        {job.progress > 0 && job.progress < 100 && <p className="mt-1 text-xs text-primary">처리 {job.progress}%</p>}
                                        {job.error && <p className="mt-1 text-xs text-destructive">{job.error}</p>}
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-muted-foreground">대상 학생</label>
                                        <Select disabled={workflowLocked} value={job.targetStudentId || undefined} onValueChange={(value) => updateLocalJob(job.localId, { targetStudentId: value })}>
                                            <SelectTrigger><SelectValue placeholder="학생 선택" /></SelectTrigger>
                                            <SelectContent>
                                                {activeStudents.map((student) => <SelectItem key={student.id} value={student.id}>{studentLabel(student)}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                                        <div><label className="mb-1 block text-xs font-medium text-muted-foreground">과제명</label><Input disabled={workflowLocked} value={job.title} onChange={(event) => updateLocalJob(job.localId, { title: event.target.value })} /></div>
                                        <div><label className="mb-1 block text-xs font-medium text-muted-foreground">기한</label><Input disabled={workflowLocked} type="datetime-local" value={job.dueAt} onChange={(event) => updateLocalJob(job.localId, { dueAt: event.target.value })} /></div>
                                    </div>
                                    <Button type="button" variant="ghost" size="icon-sm" disabled={workflowLocked} aria-label={`${job.file.name} 제거`} onClick={() => {
                                        if (workflowLocked) return;
                                        URL.revokeObjectURL(job.previewUrl);
                                        setLocalJobs((current) => current.filter((item) => item.localId !== job.localId));
                                    }}><X className="h-4 w-4" /></Button>
                                    {job.requiresManualCodes && (
                                        <div className="rounded-lg border border-warning/30 bg-warning-soft p-3 lg:col-span-4">
                                            <p className="text-sm font-semibold text-warning-foreground">OCR로 7자리 코드를 찾지 못했습니다.</p>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                PDF 순서대로 한 줄에 하나씩 <code>페이지: 1234567</code> 형식으로 입력하세요. 1페이지 PDF는 코드만 입력해도 됩니다.
                                            </p>
                                            <Textarea
                                                className="mt-2 font-mono"
                                                value={job.manualCodeDraft}
                                                onChange={(event) => updateLocalJob(job.localId, { manualCodeDraft: event.target.value })}
                                                placeholder={'1: 1234567\n1: 1234568\n2: 1234569'}
                                                disabled={workflowLocked}
                                            />
                                        </div>
                                    )}
                                </div>
                            ))}

                            <div className="flex justify-end gap-2">
                                {(localJobs.length > 0 || activeBatchId) && <Button type="button" variant="outline" onClick={reset} disabled={working || rehydratingBatch}>{batch || activeBatchId ? '새 작업 시작' : '초기화'}</Button>}
                                <Button type="button" onClick={() => void prepareAndUpload()} disabled={working || localJobs.length === 0 || loading || rehydratingBatch || Boolean(activeBatchId && !batch) || batch?.status === 'expired'}>
                                    {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSearch className="mr-2 h-4 w-4" />}
                                    {batch ? '업로드·매칭 재시도' : localJobs.some((job) => job.requiresManualCodes) ? '직접 입력 코드로 계속' : '업로드하고 코드 매칭'}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {batch && (
                <Card>
                    <CardHeader className="flex-row items-center justify-between gap-3">
                        <div><CardTitle>매칭 검토</CardTitle><p className="mt-1 text-xs text-muted-foreground">문항 순서와 대상 학생을 확인한 뒤 배정하세요.</p></div>
                        <div className="flex gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => void refreshBatch(batch.id, selectedReviewJob?.id)} disabled={working}><RefreshCw className="mr-2 h-4 w-4" />새로고침</Button>
                            {batch.mode === 'batch' && <Button type="button" size="sm" onClick={() => void finalizeReadyJobs()} disabled={working}><Send className="mr-2 h-4 w-4" />준비된 과제 일괄 배정</Button>}
                        </div>
                    </CardHeader>
                    <CardContent className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
                        <div className="space-y-2">
                            {batch.jobs.map((job) => (
                                <button key={job.id} type="button" className={`w-full rounded-lg border p-3 text-left ${selectedReviewJob?.id === job.id ? 'border-primary bg-primary-soft' : 'bg-card'}`} onClick={() => {
                                    setSelectedReviewJobId(job.id);
                                    void refreshReviewJob(job.id).catch((error) => {
                                        toast.error(error instanceof Error ? error.message : '문항 미리보기를 불러오지 못했습니다.');
                                    });
                                }}>
                                    <div className="flex items-start justify-between gap-2"><span className="min-w-0 truncate text-sm font-semibold">{job.fileName}</span><StatusBadge tone={statusTone(job.status)} label={statusLabel(job.status)} /></div>
                                    <p className="mt-1 text-xs text-muted-foreground">일치 {job.summary.matched}/{job.summary.total} · 확인 필요 {job.summary.total - job.summary.matched}</p>
                                </button>
                            ))}
                        </div>

                        {selectedReviewJob && (
                            <div className="min-w-0 space-y-4">
                                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3">
                                    <div>
                                        <p className="font-semibold text-foreground">{selectedReviewJob.title}</p>
                                        <p className="text-xs text-muted-foreground">{activeStudents.find((student) => student.id === selectedReviewJob.targetStudentId)?.name || '학생 미지정'} · {selectedReviewJob.pageCount || '-'}페이지</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <StatusBadge
                                            tone={selectedReviewJob.status === 'expired' ? 'neutral' : selectedReviewJob.summary.ready ? 'success' : 'warning'}
                                            label={selectedReviewJob.status === 'expired' ? '만료' : selectedReviewJob.summary.ready ? '전체 일치' : '확인 필요'}
                                        />
                                        <Button type="button" onClick={() => void finalizeOne(selectedReviewJob)} disabled={working || !selectedReviewJob.summary.ready || selectedReviewJob.status !== 'ready'}>
                                            {selectedReviewJob.status === 'assigned' ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <Send className="mr-2 h-4 w-4" />}
                                            {selectedReviewJob.status === 'assigned' ? '배정 완료' : selectedReviewJob.status === 'expired' ? '만료됨' : '이 학생에게 배정'}
                                        </Button>
                                    </div>
                                </div>

                                {selectedLocalJob?.previewUrl ? (
                                    <iframe title={`${selectedReviewJob.fileName} 미리보기`} src={selectedLocalJob.previewUrl} className="h-[420px] w-full rounded-lg border bg-card" />
                                ) : (
                                    <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
                                        {!['upload_pending', 'uploaded'].includes(selectedReviewJob.status)
                                            ? '브라우저를 새로 연 뒤에는 로컬 PDF 미리보기를 복원할 수 없습니다. 저장된 문항 순서와 DB crop 검토·과제 배정은 계속할 수 있습니다.'
                                            : '브라우저를 새로 연 뒤에는 업로드 전 로컬 PDF를 복원할 수 없습니다. 이 작업을 계속할 자료가 없으므로 새 작업을 시작하고 PDF를 다시 선택하세요.'}
                                    </div>
                                )}

                                {!selectedReviewJob.summary.ready && (
                                    <div className="rounded-lg border border-warning/30 bg-warning-soft p-3">
                                        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-warning-foreground"><AlertTriangle className="h-4 w-4" />코드 수정 후 다시 매칭</div>
                                        <Textarea value={codeDrafts[selectedReviewJob.id] || ''} onChange={(event) => setCodeDrafts((current) => ({ ...current, [selectedReviewJob.id]: event.target.value }))} placeholder="7자리 코드를 PDF 순서대로 한 줄에 하나씩 입력" />
                                        <div className="mt-2 flex justify-end"><Button type="button" variant="outline" size="sm" onClick={() => void reResolve(selectedReviewJob)} disabled={working}>수정 코드로 재매칭</Button></div>
                                    </div>
                                )}

                                <div className="max-h-[520px] overflow-auto rounded-lg border">
                                    <table className="w-full text-sm">
                                        <thead className="sticky top-0 bg-muted"><tr><th className="px-3 py-2 text-left">순서</th><th className="px-3 py-2 text-left">코드</th><th className="px-3 py-2 text-left">문항</th><th className="px-3 py-2 text-left">단원 · 유형</th><th className="px-3 py-2 text-left">상태</th></tr></thead>
                                        <tbody>
                                            {selectedReviewJob.items.map((item) => (
                                                <tr key={`${item.ordinal}:${item.externalCode}`} className="border-t">
                                                    <td className="px-3 py-2">{item.ordinal}</td>
                                                    <td className="px-3 py-2 font-mono">{item.externalCode}</td>
                                                    <td className="px-3 py-2">
                                                        <div className="flex items-center gap-2">
                                                            {item.imageUrl && (
                                                                // eslint-disable-next-line @next/next/no-img-element
                                                                <img src={item.imageUrl} alt="" className="h-12 w-16 rounded border bg-white object-contain" />
                                                            )}
                                                            <span>{item.number || '-'}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-2"><span className="block">{item.unitName || '-'}</span><span className="text-xs text-muted-foreground">{item.typeName || '-'}</span></td>
                                                    <td className="px-3 py-2"><StatusBadge tone={statusTone(item.status)} label={statusLabel(item.status)} /></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
        </PageShell>
    );
}
