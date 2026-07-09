import { describe, expect, it } from 'vitest';
import { ApiContractError, decodeCursor, encodeCursor } from './api-contracts';
import {
    assertRosterCursorFilter,
    buildPeopleSearchOrFilter,
    isStudentRosterCursor,
    parseStaffRosterFilters,
    parseStudentRosterFilters,
    studentRosterFilterKey,
} from './roster-filters';

describe('roster filters', () => {
    it('normalizes student filters into a stable cursor key', () => {
        const filters = parseStudentRosterFilters({
            q: '  홍길동  ',
            classId: 'class-1',
            status: 'active',
        });
        expect(filters).toEqual({ q: '홍길동', classId: 'class-1', status: 'active' });
        expect(studentRosterFilterKey(filters)).toBe('["홍길동","class-1","active"]');
    });

    it.each([
        () => parseStudentRosterFilters({ status: 'unknown' }),
        () => parseStudentRosterFilters({ classId: 'bad,class' }),
        () => parseStaffRosterFilters({ role: 'owner' }),
        () => parseStaffRosterFilters({ status: 'retired' }),
    ])('rejects unsupported filter input', (parse) => {
        expect(parse).toThrow(ApiContractError);
    });

    it('binds a cursor to its normalized filter state', () => {
        const filterKey = studentRosterFilterKey(parseStudentRosterFilters({ q: 'kim' }));
        const encoded = encodeCursor({
            createdAt: '2026-07-10T00:00:00.000Z',
            id: '11111111-1111-4111-8111-111111111111',
            filterKey,
        });
        const cursor = decodeCursor(encoded, isStudentRosterCursor);

        expect(cursor?.filterKey).toBe(filterKey);
        expect(() => assertRosterCursorFilter(cursor?.filterKey || '', '["lee","","operations"]'))
            .toThrow(ApiContractError);
    });

    it('quotes PostgREST search values and rejects untrusted field names', () => {
        expect(buildPeopleSearchOrFilter('kim"),id.neq.1', ['display_name', 'phone']))
            .toBe('display_name.ilike."%kim\\"),id.neq.1%",phone.ilike."%kim\\"),id.neq.1%"');
        expect(() => buildPeopleSearchOrFilter('kim', ['display_name,id.neq.1']))
            .toThrow('trusted column names');
    });

});
