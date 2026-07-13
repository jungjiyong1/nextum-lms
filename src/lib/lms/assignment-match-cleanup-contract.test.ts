import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const route = readFileSync('src/app/api/cron/assignment-match-cleanup/route.ts', 'utf8');
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons?: Array<{ path: string }> };

describe('assignment match retention cleanup', () => {
    it('expires jobs through a service-only RPC and retries undeleted storage paths', () => {
        expect(route).toContain("rpc('expire_assignment_matches_v1'");
        expect(route).toContain(".is('source_deleted_at', null)");
        expect(route).toContain('storage.from(ASSIGNMENT_FILES_BUCKET).remove(paths)');
        expect(route).toContain(".in('status', ['expired', 'assigned'])");
        expect(route).toContain('timingSafeEqual');
    });

    it('is scheduled by Vercel cron', () => {
        expect(vercel.crons?.some((cron) => cron.path === '/api/cron/assignment-match-cleanup')).toBe(true);
    });
});
