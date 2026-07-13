import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isFeatureEnabledUnlessExplicitlyDisabled } from '@/lib/feature-flags';

const service = readFileSync('src/lib/lms/assignment-match.ts', 'utf8');
const feature = readFileSync('src/lib/lms/pdf-assignment-match-feature.ts', 'utf8');
const page = readFileSync('src/app/(app)/assignments/pdf-match/page.tsx', 'utf8');
const layout = readFileSync('src/app/(app)/layout.tsx', 'utf8');
const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');

describe('PDF assignment match rollback gate', () => {
    it.each([
        [undefined, true],
        [null, true],
        ['', true],
        ['false', false],
        [' FALSE ', false],
        ['1', true],
        ['enabled', true],
        [' true ', true],
        ['TRUE', true],
    ])('defaults to enabled and treats only an explicit false value as disabled: %s', (value, expected) => {
        expect(isFeatureEnabledUnlessExplicitlyDisabled(value)).toBe(expected);
    });

    it('closes every server operation and derives all UI state from the server flag', () => {
        expect(feature).toContain('process.env.PDF_ASSIGNMENT_MATCH_ENABLED');
        expect(feature).toContain('isFeatureEnabledUnlessExplicitlyDisabled');
        expect(service.match(/assertPdfAssignmentMatchEnabled\(\);/gu)).toHaveLength(7);
        expect(service).toContain('PDF_ASSIGNMENT_MATCH_DISABLED');
        expect(service).toContain('503');
        expect(page).toContain('isPdfAssignmentMatchEnabled()');
        expect(page).toContain('notFound()');
        expect(layout).toContain('pdfAssignmentMatchEnabled={isPdfAssignmentMatchEnabled()}');
        expect(sidebar).toContain("child.id !== 'assignments-pdf-match'");
        expect(sidebar).not.toContain('NEXT_PUBLIC_PDF_ASSIGNMENT_MATCH_ENABLED');
    });
});
