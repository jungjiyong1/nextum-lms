import { describe, expect, it } from 'vitest';
import {
    AssignmentMatchError,
    derivePdfAssignmentMatchBatchStatus,
    emptyMatchSummary,
    isValidExternalCode,
    normalizeCodes,
    normalizeCreateMatchBatch,
    normalizeDueAt,
    normalizePageCount,
    normalizePdfFileName,
    normalizePdfFileSize,
    normalizeRequestId,
    normalizeRevision,
    normalizeSha256,
    normalizeStoredSummary,
    normalizeStudentId,
    normalizeTitle,
    resolveCodeItems,
    resolveFinalizeRevision,
    type MatchCandidate,
} from './assignment-match-domain';

const STUDENT_ID = '00000000-0000-4000-8000-000000000001';
const BOOK_ID = '00000000-0000-4000-8000-000000000002';

function errorCode(run: () => unknown): string | null {
    try {
        run();
        return null;
    } catch (error) {
        return error instanceof AssignmentMatchError ? error.code : 'unexpected';
    }
}

describe('PDF assignment match domain', () => {
    it('normalizes a single-student PDF job', () => {
        const result = normalizeCreateMatchBatch({
            mode: 'single',
            clientRequestId: 'request-1',
            jobs: [{
                fileName: '  김학생 과제.pdf ',
                fileSize: 12_345,
                pageCount: 3,
                targetStudentId: STUDENT_ID.toUpperCase(),
                title: '  함수 과제 ',
                dueAt: '2026-08-01T09:00:00+09:00',
            }],
        });

        expect(result).toMatchObject({
            mode: 'single',
            clientRequestId: 'request-1',
            jobs: [{
                fileName: '김학생 과제.pdf',
                fileSize: 12_345,
                pageCount: 3,
                targetStudentId: STUDENT_ID,
                title: '함수 과제',
                dueAt: '2026-08-01T00:00:00.000Z',
            }],
        });
    });

    it('allows unresolved students in batch mode but requires one in single mode', () => {
        expect(normalizeCreateMatchBatch({
            mode: 'batch',
            clientRequestId: 'request-2',
            jobs: [{ fileName: 'student.pdf', fileSize: 1, title: '과제' }],
        }).jobs[0]?.targetStudentId).toBeNull();
        expect(errorCode(() => normalizeCreateMatchBatch({
            mode: 'single',
            clientRequestId: 'request-3',
            jobs: [{ fileName: 'student.pdf', fileSize: 1, title: '과제' }],
        }))).toBe('TARGET_STUDENT_REQUIRED');
    });

    it('rejects unsafe, answer, non-PDF, and oversized files', () => {
        expect(errorCode(() => normalizePdfFileName('../student.pdf'))).toBe('INVALID_PDF_FILE');
        expect(errorCode(() => normalizePdfFileName('중3_정답.pdf'))).toBe('ANSWER_PDF_BLOCKED');
        expect(errorCode(() => normalizePdfFileName('student.png'))).toBe('INVALID_PDF_FILE');
        expect(errorCode(() => normalizePdfFileSize(50 * 1024 * 1024 + 1))).toBe('PDF_FILE_LIMIT_EXCEEDED');
        expect(errorCode(() => normalizePdfFileSize(0))).toBe('PDF_FILE_LIMIT_EXCEEDED');
    });

    it('enforces job and page limits', () => {
        const job = { fileName: 'student.pdf', fileSize: 1, title: '과제' };
        expect(errorCode(() => normalizeCreateMatchBatch({
            mode: 'single',
            clientRequestId: 'r',
            jobs: [job, job],
        }))).toBe('INVALID_MATCH_JOB_COUNT');
        expect(errorCode(() => normalizeCreateMatchBatch({
            mode: 'batch',
            clientRequestId: 'r',
            jobs: Array.from({ length: 51 }, () => job),
        }))).toBe('INVALID_MATCH_JOB_COUNT');
        expect(errorCode(() => normalizePageCount(201))).toBe('PDF_PAGE_LIMIT_EXCEEDED');
        expect(normalizePageCount(200)).toBe(200);
    });

    it('normalizes bounded code positions while retaining invalid codes for review', () => {
        const result = normalizeCodes([
            { externalCode: ' 1234567 ', page: 1, bbox: { x: 1, y: 2, width: 3, height: 4 } },
            { externalCode: 'bad-code', page: 2 },
        ], 2);
        expect(result).toEqual([
            { externalCode: '1234567', page: 1, bbox: { x: 1, y: 2, width: 3, height: 4 } },
            { externalCode: 'bad-code', page: 2, bbox: null },
        ]);
        expect(errorCode(() => normalizeCodes([{ externalCode: '1234567', page: 3 }], 2))).toBe('INVALID_CODE_POSITION');
        expect(errorCode(() => normalizeCodes([], 2))).toBe('INVALID_CODE_COUNT');
    });

    it('classifies matched, duplicate, unknown, unverified, blocked, and invalid codes', () => {
        const matched: MatchCandidate = {
            problemId: 'problem-1',
            bookId: BOOK_ID,
            verified: true,
            number: '1',
            unitName: '함수',
            typeName: '그래프',
            imagePath: 'bank/problem-1.png',
        };
        const candidates = new Map<string, MatchCandidate | null>([
            ['1111111', matched],
            ['2222222', { ...matched, problemId: 'problem-2', verified: false }],
            ['3333333', { ...matched, problemId: 'problem-3', bookId: 'other-book' }],
            ['4444444', null],
            ['6666666', { ...matched, problemId: 'problem-6' }],
        ]);
        const codes = normalizeCodes([
            { externalCode: '1111111', page: 1 },
            { externalCode: '2222222', page: 1 },
            { externalCode: '3333333', page: 1 },
            { externalCode: '4444444', page: 1 },
            { externalCode: '5555555', page: 1 },
            { externalCode: '6666666', page: 1 },
            { externalCode: '6666666', page: 2 },
            { externalCode: 'invalid', page: 2 },
        ], 2);
        const result = resolveCodeItems(codes, candidates, BOOK_ID);

        expect(result.items.map((item) => item.status)).toEqual([
            'matched',
            'unverified',
            'blocked',
            'blocked',
            'unknown',
            'duplicate',
            'duplicate',
            'invalid',
        ]);
        expect(result.items[0]).toMatchObject({ problemId: 'problem-1', unitName: '함수', imageUrl: null });
        expect(result.summary).toEqual({
            total: 8,
            matched: 1,
            unknown: 1,
            duplicate: 2,
            unverified: 1,
            blocked: 2,
            invalid: 1,
            ready: false,
        });
    });

    it('marks a non-empty all-matched sequence ready in PDF order', () => {
        const candidate: MatchCandidate = {
            problemId: 'p1',
            bookId: BOOK_ID,
            verified: true,
            number: '17',
            unitName: null,
            typeName: null,
            imagePath: null,
        };
        const result = resolveCodeItems(
            normalizeCodes([{ externalCode: '7654321', page: 2 }], 2),
            new Map([['7654321', candidate]]),
            BOOK_ID,
        );
        expect(result.items[0]?.ordinal).toBe(1);
        expect(result.summary.ready).toBe(true);
    });

    it('normalizes primitive request fields and rejects malformed values', () => {
        expect(normalizeRequestId('request_1')).toBe('request_1');
        expect(normalizeRevision(2)).toBe(2);
        expect(normalizeStudentId(null, false)).toBeNull();
        expect(normalizeTitle(' 제목 ')).toBe('제목');
        expect(normalizeDueAt(null)).toBeNull();
        expect(normalizeSha256('A'.repeat(64))).toBe('a'.repeat(64));
        expect(isValidExternalCode('1234567')).toBe(true);
        expect(isValidExternalCode('123')).toBe(false);
        expect(errorCode(() => normalizeRequestId('bad key'))).toBe('INVALID_IDEMPOTENCY_KEY');
        expect(errorCode(() => normalizeRevision(0))).toBe('INVALID_MATCH_REVISION');
        expect(errorCode(() => normalizeStudentId('bad', false))).toBe('INVALID_TARGET_STUDENT');
        expect(errorCode(() => normalizeDueAt('never'))).toBe('INVALID_DUE_AT');
        expect(errorCode(() => normalizeSha256('abc'))).toBe('INVALID_PDF_HASH');
    });

    it('keeps ready jobs strict but lets an assigned job retry with its current revision', () => {
        expect(resolveFinalizeRevision('ready', 4, 4)).toBe(4);
        expect(errorCode(() => resolveFinalizeRevision('ready', 5, 4))).toBe('MATCH_REVISION_CONFLICT');
        expect(resolveFinalizeRevision('assigned', 6, 4)).toBe(6);
    });

    it('sanitizes persisted summaries instead of trusting stale ready flags', () => {
        expect(emptyMatchSummary()).toEqual({
            total: 0,
            matched: 0,
            unknown: 0,
            duplicate: 0,
            unverified: 0,
            blocked: 0,
            invalid: 0,
            ready: false,
        });
        expect(normalizeStoredSummary({ total: 2, matched: 1, unknown: -1, ready: true })).toMatchObject({
            total: 2,
            matched: 1,
            unknown: 0,
            ready: false,
        });
        expect(normalizeStoredSummary(null).ready).toBe(false);
    });

    it('keeps expired jobs terminal when deriving the batch status', () => {
        expect(derivePdfAssignmentMatchBatchStatus(['expired'])).toBe('expired');
        expect(derivePdfAssignmentMatchBatchStatus(['expired', 'cancelled'])).toBe('expired');
        expect(derivePdfAssignmentMatchBatchStatus(['assigned', 'expired'])).toBe('partially_assigned');
        expect(derivePdfAssignmentMatchBatchStatus(['cancelled'])).toBe('cancelled');
    });
});
