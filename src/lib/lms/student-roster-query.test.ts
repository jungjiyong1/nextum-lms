import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { loadStudentRosterPageRows } from './student-queries';
import { parseStudentRosterFilters } from './roster-filters';

type QueryCall = { method: string; args: unknown[] };

function mockCore(rows: Array<Record<string, unknown>> = []) {
    const calls: QueryCall[] = [];
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'limit', 'or', 'in', 'neq', 'abortSignal']) {
        builder[method] = (...args: unknown[]) => {
            calls.push({ method, args });
            return builder;
        };
    }
    builder.then = (
        onFulfilled: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);

    const from = vi.fn((table: string) => {
        calls.push({ method: 'from', args: [table] });
        return builder;
    });
    return { core: { from }, calls, from };
}

describe('bounded student roster query', () => {
    it('pushes people and assigned-class filters into one limit+1 query', async () => {
        const { core, calls, from } = mockCore([{ id: 'student-1', created_at: '2026-07-10T00:00:00Z' }]);
        const controller = new AbortController();
        const rows = await loadStudentRosterPageRows({
            core: core as never,
            academyId: 'academy-1',
            assignedClassIds: new Set(['class-1', 'class-2']),
            filters: parseStudentRosterFilters({ q: 'kim', status: 'operations' }),
            cursor: {
                createdAt: '2026-07-10T00:00:00.000Z',
                id: '11111111-1111-4111-8111-111111111111',
                filterKey: 'bound-by-caller',
            },
            limit: 50,
            signal: controller.signal,
        });

        expect(rows).toHaveLength(1);
        expect(from).toHaveBeenCalledTimes(1);
        expect(calls.find((call) => call.method === 'select')?.args[0]).toContain('people!inner()');
        expect(calls.find((call) => call.method === 'select')?.args[0]).toContain('class_students!inner()');
        expect(calls.filter((call) => call.method === 'limit')).toEqual([{ method: 'limit', args: [51] }]);
        expect(calls).toContainEqual({
            method: 'in',
            args: ['class_students.class_id', ['class-1', 'class-2']],
        });
        expect(calls).toContainEqual({ method: 'eq', args: ['academy_id', 'academy-1'] });
        expect(calls.some((call) => call.method === 'eq' && call.args[0] === 'people.primary_academy_id')).toBe(false);
        expect(calls.some((call) => call.method === 'or'
            && (call.args[1] as { referencedTable?: string } | undefined)?.referencedTable === 'people')).toBe(true);
        expect(calls.some((call) => call.method === 'in' && call.args[0] === 'id')).toBe(false);
        expect(calls).toContainEqual({ method: 'abortSignal', args: [controller.signal] });
    });

    it('does not issue a query for an empty assigned-class scope', async () => {
        const { core, from } = mockCore();
        const rows = await loadStudentRosterPageRows({
            core: core as never,
            academyId: 'academy-1',
            assignedClassIds: new Set(),
            filters: parseStudentRosterFilters({ q: 'common' }),
            cursor: null,
            limit: 50,
        });

        expect(rows).toEqual([]);
        expect(from).not.toHaveBeenCalled();
    });

    it('anchors tenant scope on students without excluding a person whose primary academy differs', async () => {
        const { core, calls } = mockCore();
        await loadStudentRosterPageRows({
            core: core as never,
            academyId: 'academy-current',
            assignedClassIds: null,
            filters: parseStudentRosterFilters({ q: 'shared person' }),
            cursor: null,
            limit: 20,
        });

        expect(calls).toContainEqual({ method: 'eq', args: ['academy_id', 'academy-current'] });
        expect(calls.some((call) => call.method === 'eq' && call.args[0] === 'people.primary_academy_id')).toBe(false);
    });
});
