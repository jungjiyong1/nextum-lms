import { timingSafeEqual } from 'node:crypto';
import { ASSIGNMENT_FILES_BUCKET } from '@/lib/lms/assignment-files-storage';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Row = Record<string, unknown>;

function authorized(request: Request): boolean {
    const expected = process.env.CRON_SECRET;
    const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/iu, '') || '';
    if (!expected || !supplied) return false;
    const expectedBytes = Buffer.from(expected);
    const suppliedBytes = Buffer.from(supplied);
    return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function chunks<T>(values: readonly T[], size: number): T[][] {
    const result: T[][] = [];
    for (let offset = 0; offset < values.length; offset += size) result.push(values.slice(offset, offset + size));
    return result;
}

export async function GET(request: Request) {
    if (!process.env.CRON_SECRET) {
        return Response.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 });
    }
    if (!authorized(request)) return Response.json({ error: 'Unauthorized.' }, { status: 401 });

    const client = createAdminClient();
    const learning = client.schema('learning');
    const { error: expireError } = await learning.rpc('expire_assignment_matches_v1', {
        p_now: new Date().toISOString(),
    });
    if (expireError) {
        console.error('[assignment-match-cleanup] Expiry RPC failed:', expireError);
        return Response.json({ error: 'Could not expire assignment match jobs.' }, { status: 500 });
    }

    const { data, error: loadError } = await learning
        .from('assignment_match_jobs')
        .select('id,file_path')
        .in('status', ['expired', 'assigned'])
        .is('assignment_id', null)
        .is('source_deleted_at', null)
        .not('file_path', 'is', null)
        .order('expires_at', { ascending: true })
        .limit(1_000);
    if (loadError) {
        console.error('[assignment-match-cleanup] Expired job lookup failed:', loadError);
        return Response.json({ error: 'Could not load expired assignment files.' }, { status: 500 });
    }

    const rows = (data || []) as Row[];
    const deletedJobIds: string[] = [];
    for (const batch of chunks(rows, 100)) {
        const paths = batch.map((row) => String(row.file_path));
        const { error } = await client.storage.from(ASSIGNMENT_FILES_BUCKET).remove(paths);
        if (error) {
            console.error('[assignment-match-cleanup] Storage delete failed:', error);
            continue;
        }
        deletedJobIds.push(...batch.map((row) => String(row.id)));
    }

    if (deletedJobIds.length > 0) {
        const deletedAt = new Date().toISOString();
        for (const ids of chunks(deletedJobIds, 200)) {
            const { error } = await learning
                .from('assignment_match_jobs')
                .update({ source_deleted_at: deletedAt })
                .in('id', ids)
                .in('status', ['expired', 'assigned'])
                .is('assignment_id', null);
            if (error) {
                console.error('[assignment-match-cleanup] Cleanup marker update failed:', error);
            }
        }
    }

    return Response.json({ expiredFilesFound: rows.length, filesDeleted: deletedJobIds.length }, {
        headers: { 'Cache-Control': 'no-store' },
    });
}
