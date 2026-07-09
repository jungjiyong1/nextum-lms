interface AssignmentScopeRow {
    class_id?: unknown;
    student_id?: unknown;
    status?: unknown;
}

function stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

export function unresolvedAssignmentRecipientStudentIds(
    assignedClassIds: ReadonlySet<string>,
    recipientRows: AssignmentScopeRow[],
): string[] {
    return [...new Set(recipientRows
        .filter((row) => {
            const classId = stringValue(row.class_id);
            return classId === null || !assignedClassIds.has(classId);
        })
        .map((row) => stringValue(row.student_id))
        .filter((studentId): studentId is string => studentId !== null))];
}

export function hasAssignedAssignmentScope(
    assignedClassIds: ReadonlySet<string>,
    targetRows: AssignmentScopeRow[],
    recipientRows: AssignmentScopeRow[],
    enrollmentRows: AssignmentScopeRow[] = [],
): boolean {
    if (targetRows.length === 0 && recipientRows.length === 0) return false;
    if (targetRows.some((row) => {
        const classId = stringValue(row.class_id);
        return classId === null || !assignedClassIds.has(classId);
    })) {
        return false;
    }

    const enrolledStudentIds = new Set(
        enrollmentRows
            .filter((row) => {
                const classId = stringValue(row.class_id);
                return row.status === 'active' && classId !== null && assignedClassIds.has(classId);
            })
            .map((row) => stringValue(row.student_id))
            .filter((studentId): studentId is string => studentId !== null),
    );
    return recipientRows.every((row) => {
        const classId = stringValue(row.class_id);
        if (classId !== null && assignedClassIds.has(classId)) return true;
        const studentId = stringValue(row.student_id);
        return studentId !== null && enrolledStudentIds.has(studentId);
    });
}
