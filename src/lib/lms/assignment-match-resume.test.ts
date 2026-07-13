import { describe, expect, it } from 'vitest';
import {
    activeAssignmentMatchBatchId,
    assignmentMatchStorageKey,
    assignmentMatchUrlWithBatchId,
    normalizeAssignmentMatchBatchId,
} from './assignment-match-resume';

const URL_BATCH = '00000000-0000-4000-8000-000000000001';
const STORED_BATCH = '00000000-0000-4000-8000-000000000002';

describe('assignment match resume state', () => {
    it('prefers a valid URL batch and falls back to the academy-scoped stored batch', () => {
        expect(activeAssignmentMatchBatchId(`https://example.test/assignments/pdf-match?matchBatch=${URL_BATCH}`, STORED_BATCH)).toBe(URL_BATCH);
        expect(activeAssignmentMatchBatchId('https://example.test/assignments/pdf-match?matchBatch=bad', STORED_BATCH)).toBe(STORED_BATCH);
        expect(activeAssignmentMatchBatchId('https://example.test/assignments/pdf-match', null)).toBeNull();
        expect(assignmentMatchStorageKey('academy-1')).toContain('academy-1');
    });

    it('adds and explicitly removes the resumable batch query without losing other URL state', () => {
        const withBatch = assignmentMatchUrlWithBatchId('https://example.test/assignments/pdf-match?tab=review#items', URL_BATCH);
        expect(withBatch).toBe(`/assignments/pdf-match?tab=review&matchBatch=${URL_BATCH}#items`);
        expect(assignmentMatchUrlWithBatchId(`https://example.test${withBatch}`, null)).toBe('/assignments/pdf-match?tab=review#items');
        expect(normalizeAssignmentMatchBatchId('not-a-uuid')).toBeNull();
    });
});
