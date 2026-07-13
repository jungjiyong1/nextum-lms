import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/features/lms/pdf-assignment-match-page.tsx', 'utf8');

describe('PDF assignment matching page contract', () => {
    it('supports exact-code single-student and batch workflows', () => {
        expect(page).toContain("useState<PdfAssignmentMatchMode>('single')");
        expect(page).toContain('PDF_ASSIGNMENT_MAX_BATCH_JOBS');
        expect(page).toContain('extractStudyqCodesFromPdf');
        expect(page).toContain('uploadToSignedSupabasePath');
        expect(page).toContain('finalizePdfAssignmentMatchJob');
        expect(page).toContain('finalizePdfAssignmentMatchBatch');
    });

    it('requires visible seven-digit codes and blocks answer PDFs', () => {
        expect(page).toContain('ANSWER_FILE_PATTERN');
        expect(page).toContain('7자리 문항코드');
        expect(page).toContain("magic !== '%PDF-'");
    });

    it('locks local assignment inputs after server creation and keeps previews mapped by remote job id', () => {
        expect(page).toContain('remoteJobId: string | null');
        expect(page).toContain('job.remoteJobId === selectedReviewJob.id');
        expect(page).toContain('disabled={workflowLocked}');
        expect(page).toContain("batch || activeBatchId ? '새 작업 시작' : '초기화'");
        expect(page).toContain('서버 작업이 생성되어 학생·과제명·기한과 파일 구성을 잠갔습니다.');
    });

    it('persists and rehydrates an active batch without requiring the browser File object', () => {
        expect(page).toContain('assignmentMatchStorageKey');
        expect(page).toContain('assignmentMatchUrlWithBatchId');
        expect(page).toContain('activeAssignmentMatchBatchId');
        expect(page).toContain('resumeActiveBatch(batchId)');
        expect(page).toContain('persistActiveBatchId(created.batch.id)');
        expect(page).toContain('로컬 PDF 미리보기를 복원할 수 없습니다');
    });

    it('loads signed problem images only for the selected review job and renders expiration as terminal', () => {
        expect(page).toContain('loadPdfAssignmentMatchJob');
        expect(page).toContain('refreshReviewJob(job.id)');
        expect(page).toContain("expired: '만료'");
        expect(page).toContain("selectedReviewJob.status !== 'ready'");
    });
});
