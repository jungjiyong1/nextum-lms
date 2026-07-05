import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

type AuditPayload = unknown;

export interface AdminAuditAction {
    academyId: string;
    actorPersonId: string;
    action: string;
    target?: string | null;
    payload?: AuditPayload;
}

export async function recordAdminAction({
    academyId,
    actorPersonId,
    action,
    target = null,
    payload = {},
}: AdminAuditAction) {
    const client = createAdminClient();
    const { error } = await client.schema('audit').from('admin_actions').insert({
        academy_id: academyId,
        actor_id: actorPersonId,
        action,
        target,
        payload,
    });

    if (error) {
        throw new Error(`Failed to write admin audit log: ${error.message}`);
    }
}
