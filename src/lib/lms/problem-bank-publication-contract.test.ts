import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const assignmentQueries = readFileSync('src/lib/lms/assignment-queries.ts', 'utf8');
const problemCatalog = readFileSync('src/lib/lms/problem-catalog.ts', 'utf8');
const mutations = readFileSync('src/lib/lms/mutations.ts', 'utf8');
const worksheetImport = readFileSync('src/lib/lms/assignment-import.ts', 'utf8');

describe('published problem bank contract', () => {
    it('only exposes catalog books with verified non-example problems', () => {
        expect(assignmentQueries).toContain("row.metadata?.visibility === 'catalog'");
        expect(assignmentQueries).toContain(".eq('verified', true)");
        expect(assignmentQueries).toContain('publishedUnitIds');
        expect(problemCatalog).toContain("bookRow.metadata?.visibility !== 'catalog'");
        expect(problemCatalog).toContain(".eq('verified', true)");
    });

    it('rejects hidden books and unverified problems from assignment creation', () => {
        expect(mutations).toContain("book.metadata?.visibility !== 'catalog'");
        expect(mutations.match(/\.eq\('verified', true\)/gu)?.length).toBeGreaterThanOrEqual(2);
        expect(mutations).toContain("allowAssignmentHidden: input.sourceType === 'worksheet'");
        expect(mutations).toContain("metadata: { visibility: 'catalog' }");
    });

    it('scopes legacy worksheet concepts and problem types to their unit', () => {
        expect(worksheetImport).toContain("onConflict: 'book_id,unit_id,name'");
        expect(worksheetImport).toContain('conceptIdByKey');
        expect(worksheetImport).toContain('typeIdByKey');
        expect(worksheetImport).not.toContain("onConflict: 'book_id,name'");
    });

    it('does not attach answer-bearing worksheet exports to student assignments', () => {
        expect(worksheetImport).not.toContain('attachUploadedExportFile');
        expect(worksheetImport).not.toContain("from('assignment_files')");
        expect(worksheetImport).not.toContain("from(ASSIGNMENT_FILES_BUCKET)");
    });
});
