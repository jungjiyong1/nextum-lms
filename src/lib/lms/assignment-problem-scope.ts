import type { AssignmentProblemScope } from '@/features/lms/types';

export interface AssignmentScopeProblemRow {
    unit_id?: string | null;
    problem_type_id?: string | null;
    type_id?: string | null;
    middle_unit?: string | null;
}

const MAX_ASSIGNMENT_PROBLEM_SCOPES = 2_000;

export function normalizeAssignmentProblemScopes(value: unknown): AssignmentProblemScope[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > MAX_ASSIGNMENT_PROBLEM_SCOPES) {
        throw new Error('Assignment problem scopes are invalid.');
    }

    const scopes = new Map<string, AssignmentProblemScope>();
    for (const candidate of value) {
        if (!candidate || typeof candidate !== 'object') throw new Error('Assignment problem scopes are invalid.');
        const row = candidate as Partial<AssignmentProblemScope>;
        const unitId = typeof row.unitId === 'string' ? row.unitId.trim() : '';
        const problemTypeId = typeof row.problemTypeId === 'string' ? row.problemTypeId.trim() : null;
        const middleUnitName = typeof row.middleUnitName === 'string' ? row.middleUnitName.trim() : null;
        if (row.unassignedMiddleUnit !== undefined && typeof row.unassignedMiddleUnit !== 'boolean') {
            throw new Error('Assignment problem scopes are invalid.');
        }
        if (!unitId || unitId.length > 512 || (problemTypeId?.length || 0) > 512 || (middleUnitName?.length || 0) > 512) {
            throw new Error('Assignment problem scopes are invalid.');
        }
        const scope = {
            unitId,
            problemTypeId: problemTypeId || null,
            middleUnitName: middleUnitName || null,
            unassignedMiddleUnit: row.unassignedMiddleUnit === true,
        } satisfies AssignmentProblemScope;
        scopes.set(
            `${scope.unitId}\u0000${scope.problemTypeId || ''}\u0000${scope.middleUnitName || ''}\u0000${scope.unassignedMiddleUnit ? 'unassigned' : ''}`,
            scope,
        );
    }
    return [...scopes.values()];
}

export function problemMatchesAssignmentScopes(
    row: AssignmentScopeProblemRow,
    scopes: readonly AssignmentProblemScope[],
): boolean {
    const typeId = row.problem_type_id || row.type_id || null;
    const middleUnitName = row.middle_unit?.trim() || null;
    return scopes.some((scope) => (
        scope.unitId === row.unit_id
        && (scope.problemTypeId === null || scope.problemTypeId === typeId)
        && (scope.unassignedMiddleUnit
            ? middleUnitName === null
            : scope.middleUnitName === null || scope.middleUnitName === middleUnitName)
    ));
}
