import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { loadStaffRosterPageRows } from './staff-queries';
import { parseStaffRosterFilters } from './roster-filters';

describe('bounded staff roster query', () => {
    const peerPermissions = {
        canCreate: false,
        canEdit: false,
        canArchive: false,
        canHardDelete: false,
        canViewPayroll: false,
        canCreatePayroll: false,
        canViewAccount: false,
        canViewSensitiveProfile: false,
        scopedToPeerClasses: true,
    };

    it('uses one bounded RPC for people, role, and class-label union', async () => {
        const data = Array.from({ length: 51 }, (_, index) => ({
            staff_id: `staff-${index}`,
            created_at: `2026-07-10T00:00:${String(index).padStart(2, '0')}Z`,
        }));
        const controller = new AbortController();
        const abortSignal = vi.fn(async () => ({ data, error: null }));
        const rpc = vi.fn(() => ({ abortSignal }));

        const rows = await loadStaffRosterPageRows({
            lms: { rpc } as never,
            academyId: 'academy-1',
            visibleStaffIds: ['staff-self', 'staff-peer'],
            searchClassIds: ['class-assigned'],
            filters: parseStaffRosterFilters({ q: '강', role: 'all', status: 'operations' }),
            cursor: {
                createdAt: '2026-07-10T00:00:00.000Z',
                id: '11111111-1111-4111-8111-111111111111',
                filterKey: 'bound-by-caller',
            },
            permissions: peerPermissions,
            limit: 50,
            signal: controller.signal,
        });

        expect(rows).toHaveLength(51);
        expect(rpc).toHaveBeenCalledTimes(1);
        expect(abortSignal).toHaveBeenCalledWith(controller.signal);
        expect(rpc).toHaveBeenCalledWith('list_staff_roster_v2', expect.objectContaining({
            p_limit: 50,
            p_include_sensitive: false,
            p_matching_roles: ['instructor'],
            p_visible_staff_ids: ['staff-self', 'staff-peer'],
            p_search_class_ids: ['class-assigned'],
            p_peer_only: true,
        }));
    });

    it('does not call the RPC for an empty peer scope', async () => {
        const rpc = vi.fn();
        const rows = await loadStaffRosterPageRows({
            lms: { rpc } as never,
            academyId: 'academy-1',
            visibleStaffIds: [],
            searchClassIds: [],
            filters: parseStaffRosterFilters({ q: 'common' }),
            cursor: null,
            permissions: peerPermissions,
            limit: 50,
        });

        expect(rows).toEqual([]);
        expect(rpc).not.toHaveBeenCalled();
    });
});
