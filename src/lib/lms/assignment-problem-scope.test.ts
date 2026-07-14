import { describe, expect, it } from 'vitest';
import {
    normalizeAssignmentProblemScopes,
    problemMatchesAssignmentScopes,
} from './assignment-problem-scope';

describe('assignment problem scopes', () => {
    it('matches the exact middle unit even when a problem type is shared', () => {
        const scopes = normalizeAssignmentProblemScopes([{
            unitId: 'unit-1',
            problemTypeId: 'type-1',
            middleUnitName: '일차방정식의 풀이',
        }]);

        expect(problemMatchesAssignmentScopes({
            unit_id: 'unit-1',
            problem_type_id: 'type-1',
            middle_unit: '일차방정식의 풀이',
        }, scopes)).toBe(true);
        expect(problemMatchesAssignmentScopes({
            unit_id: 'unit-1',
            problem_type_id: 'type-1',
            middle_unit: '방정식과 그 해',
        }, scopes)).toBe(false);
    });

    it('supports an entire middle unit and removes duplicate scopes', () => {
        const input = {
            unitId: 'unit-1',
            problemTypeId: null,
            middleUnitName: '대단원 종합',
        };
        const scopes = normalizeAssignmentProblemScopes([input, input]);

        expect(scopes).toHaveLength(1);
        expect(problemMatchesAssignmentScopes({
            unit_id: 'unit-1',
            problem_type_id: null,
            middle_unit: '대단원 종합',
        }, scopes)).toBe(true);
    });

    it('matches only problems whose middle unit is unassigned for unit summaries', () => {
        const scopes = normalizeAssignmentProblemScopes([{
            unitId: 'unit-1',
            problemTypeId: null,
            middleUnitName: null,
            unassignedMiddleUnit: true,
        }]);

        expect(problemMatchesAssignmentScopes({
            unit_id: 'unit-1',
            problem_type_id: null,
            middle_unit: null,
        }, scopes)).toBe(true);
        expect(problemMatchesAssignmentScopes({
            unit_id: 'unit-1',
            problem_type_id: null,
            middle_unit: '소인수분해',
        }, scopes)).toBe(false);
    });
});
