import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/lms/assignment-match.ts', 'utf8');
const batchFinalizeRoute = readFileSync('src/app/api/lms/assignment-match-batches/[batchId]/finalize/route.ts', 'utf8');

function functionBody(startMarker: string, endMarker: string): string {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    if (start < 0 || end < 0) throw new Error(`Missing source markers: ${startMarker}`);
    return source.slice(start, end);
}

describe('assignment match loading contract', () => {
    it('paginates items within each authorized job instead of relying on one capped batch query', () => {
        const loader = functionBody('async function loadAssignmentMatchItemRows(', 'async function attachProblemImageUrls(');
        expect(loader).toContain('loadAllAssignmentMatchItemsByJob');
        expect(loader).toContain(".eq('job_id', jobId)");
        expect(loader).toContain('.range(from, to)');
    });

    it('signs crop URLs only for a lazily loaded review job', () => {
        const batchLoader = functionBody('export async function loadAssignmentMatchBatch(', 'async function loadJobRow(');
        const jobLoader = functionBody('export async function loadAssignmentMatchJob(', 'async function loadJobDto(');
        expect(batchLoader).not.toContain('loadAssignmentMatchItemRows');
        expect(batchLoader).toContain('jobDto(row, [])');
        expect(batchLoader).not.toContain('attachProblemImageUrls');
        expect(jobLoader).toContain('loadAssignmentMatchItemRows');
        expect(jobLoader).toContain('attachProblemImageUrls');
    });

    it('retains the original target student in job audit metadata', () => {
        expect(source).toContain('original_target_student_id: job.targetStudentId');
        expect(source).toContain('client_page_count: job.pageCount');
    });

    it('finalizes large batches with bounded per-job concurrency inside an extended route budget', () => {
        const finalizeBatch = source.slice(source.indexOf('export async function finalizeAssignmentMatchBatch('));
        expect(source).toContain('BATCH_FINALIZE_CONCURRENCY = 5');
        expect(finalizeBatch).toContain('mapWithConcurrency');
        expect(finalizeBatch).toContain('{ refreshBatch: false }');
        expect(batchFinalizeRoute).toContain('export const maxDuration = 60');
    });
});
