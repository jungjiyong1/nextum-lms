import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readRoute(...segments: string[]): string {
    return readFileSync(join(process.cwd(), 'src', 'app', 'api', 'lms', ...segments), 'utf8');
}

describe('worksheet API contract', () => {
    it('cart route authenticates per academy and never caches', () => {
        const route = readRoute('worksheets', 'cart', 'route.ts');
        expect(route).toContain('assertLmsRoleForAcademy');
        expect(route).toContain("'Cache-Control': 'no-store'");
        expect(route).toContain('authErrorResponse');
    });

    it('draft route enforces origin, CSRF, academy role, and invalidation', () => {
        const route = readRoute('worksheets', 'drafts', 'route.ts');
        expect(route).toContain('assertSameOrigin');
        expect(route).toContain('assertCsrfToken');
        expect(route).toContain('assertLmsRoleForAcademy');
        expect(route).toContain('invalidation');
        expect(route).toContain('mutationException');
    });

    it('grant route is super-admin only on both read and write', () => {
        const route = readRoute('admin', 'problem-bank-grants', 'route.ts');
        const occurrences = route.split('assertSuperAdmin()').length - 1;
        expect(occurrences).toBeGreaterThanOrEqual(2);
        expect(route).toContain('assertSameOrigin');
        expect(route).toContain('assertCsrfToken');
    });

    it('draft mutation recomputes roles server-side instead of trusting the client', () => {
        const mutations = readFileSync(
            join(process.cwd(), 'src', 'lib', 'lms', 'worksheet-mutations.ts'),
            'utf8',
        );
        expect(mutations).toContain('resolveInclusionRole');
        expect(mutations).toContain('loadWorksheetCart');
        expect(mutations).not.toContain('body.evidenceEligible');
    });
});
