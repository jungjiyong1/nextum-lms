import 'server-only';

import { unstable_cache } from 'next/cache';

import { requiresAssignedClassScope } from '@/core/auth/roles';
import type {
    AssignmentBookCatalogSummary,
    AssignmentClassProgressSummary,
    AssignmentManagementData,
    AssignmentOperationsPermissions,
    AssignmentProblemProgress,
    AssignmentProblemTypeSummary,
    AssignmentProgressSummary,
    AssignmentRecipientProgress,
    AssignmentStudentProgressStatus,
    AssignmentUnitSummary,
    LearningAssignmentDetail,
    LearningAssignmentSummary,
    StudentSummary,
} from '@/features/lms/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadAllRowsById } from '@/lib/supabase/load-all-rows-by-id';
import { loadAllRowsByOffset } from '@/lib/supabase/load-all-rows-by-offset';
import type { LmsRoleContext } from './auth';
import { loadAssignedClassIdsForContext } from './class-queries';
import { sortByProblemOrder } from './problem-order';

type Row = Record<string, any>;
type LmsAdminClient = ReturnType<typeof createAdminClient>;
type SchemaClient = ReturnType<LmsAdminClient['schema']>;

const EMPTY_PROGRESS: AssignmentProgressSummary = {
    targetStudentCount: 0,
    notStartedCount: 0,
    inProgressCount: 0,
    completedCount: 0,
    completionRate: 0,
    attemptCount: 0,
    correctAttemptCount: 0,
    correctRate: null,
    lastActivityAt: null,
};

function ensureNoError(error: { message?: string } | null, context: string) {
    if (error) {
        throw new Error(`${context}: ${error.message ?? 'Unknown Supabase error'}`);
    }
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function groupRowsBy(rows: Row[], key: string): Map<string, Row[]> {
    const grouped = new Map<string, Row[]>();
    for (const row of rows) {
        const value = row[key];
        if (typeof value !== 'string' || !value) continue;
        const group = grouped.get(value) || [];
        group.push(row);
        grouped.set(value, group);
    }
    return grouped;
}

function percent(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Math.round((numerator / denominator) * 100);
}

function accuracy(correct: number, total: number): number | null {
    if (total <= 0) return null;
    return percent(correct, total);
}

function assignmentProblemLabel(pagePrinted: unknown, number: unknown, descriptor: string | null): string {
    return [`p.${Number(pagePrinted)}`, String(number), descriptor].filter(Boolean).join(' ');
}

function lastIso(values: Array<string | null | undefined>): string | null {
    let latest: string | null = null;
    for (const value of values) {
        if (value && (!latest || value > latest)) latest = value;
    }
    return latest;
}

function permissionsForContext(context: LmsRoleContext): AssignmentOperationsPermissions {
    const canManageAll = context.role === 'owner' || context.role === 'admin' || context.role === 'staff';
    return {
        canCreate: canManageAll || context.role === 'teacher' || context.role === 'instructor',
        canManageAll,
        canManageRecipients: canManageAll || context.role === 'teacher' || context.role === 'instructor',
        canRecall: canManageAll || context.role === 'teacher' || context.role === 'instructor',
        canDelete: canManageAll || context.role === 'teacher' || context.role === 'instructor',
        scopedToAssignedClasses: requiresAssignedClassScope(context.role),
    };
}

async function fetchPeople(core: SchemaClient, personIds: string[]): Promise<Map<string, Row>> {
    const ids = uniqueStrings(personIds);
    if (ids.length === 0) return new Map();
    const { data, error } = await core
        .from('people')
        .select('id,full_name,display_name,phone,parent_name,parent_phone')
        .in('id', ids);
    ensureNoError(error, 'Failed to load people');
    return new Map(((data || []) as Row[]).map((row) => [row.id, row]));
}

async function loadClasses(
    core: SchemaClient,
    academyId: string,
    allowedClassIds: Set<string> | null,
) {
    if (allowedClassIds && allowedClassIds.size === 0) return [];

    let query = core
        .from('classes')
        .select('id,name,grade,active')
        .eq('academy_id', academyId)
        .order('name');
    if (allowedClassIds) query = query.in('id', [...allowedClassIds]);

    const { data, error } = await query;
    ensureNoError(error, 'Failed to load classes');
    return ((data || []) as Row[]).map((row) => ({
        id: row.id,
        name: row.name,
        grade: row.grade ?? null,
        active: Boolean(row.active),
        status: row.status || (row.active ? 'active' : 'inactive'),
        color: row.color ?? null,
        capacity: row.capacity ?? null,
        defaultInstructorId: null,
        defaultClassroomId: null,
        courseTitle: null,
        instructorName: null,
        classroomName: null,
        studentCount: 0,
        weakTypeCount: 0,
        avgTypeScore: null,
        lastLearningAt: null,
    }));
}

async function loadAllowedStudentIds(core: SchemaClient, allowedClassIds: Set<string> | null): Promise<string[] | null> {
    if (!allowedClassIds) return null;
    if (allowedClassIds.size === 0) return [];
    const { data, error } = await core
        .from('class_students')
        .select('student_id')
        .in('class_id', [...allowedClassIds])
        .eq('status', 'active');
    ensureNoError(error, 'Failed to load assigned class students');
    return uniqueStrings(((data || []) as Row[]).map((row) => row.student_id));
}

async function loadStudents(
    core: SchemaClient,
    academyId: string,
    allowedClassIds: Set<string> | null,
): Promise<StudentSummary[]> {
    const allowedStudentIds = await loadAllowedStudentIds(core, allowedClassIds);
    if (allowedStudentIds && allowedStudentIds.length === 0) return [];

    let query = core
        .from('students')
        .select('id,person_id,status,school_type,grade')
        .eq('academy_id', academyId)
        .order('created_at', { ascending: false });
    if (allowedStudentIds) query = query.in('id', allowedStudentIds);

    const { data, error } = await query;
    ensureNoError(error, 'Failed to load students');

    const rows = (data || []) as Row[];
    const people = await fetchPeople(core, rows.map((row) => row.person_id));
    const studentIds = rows.map((row) => row.id);
    const { data: classRows, error: classError } = studentIds.length
        ? await core
            .from('class_students')
            .select('student_id,class_id,status,classes(id,name)')
            .in('student_id', studentIds)
        : { data: [], error: null };
    ensureNoError(classError, 'Failed to load student classes');

    const byStudent = new Map<string, Row[]>();
    for (const row of (classRows || []) as Row[]) {
        if (allowedClassIds && !allowedClassIds.has(row.class_id)) continue;
        const list = byStudent.get(row.student_id) || [];
        list.push(row);
        byStudent.set(row.student_id, list);
    }

    return rows.map((row) => {
        const person = people.get(row.person_id);
        const enrolled = (byStudent.get(row.id) || []).filter((item) => item.status === 'active');
        return {
            id: row.id,
            personId: row.person_id,
            name: person?.display_name || person?.full_name || 'Unknown student',
            phone: person?.phone ?? null,
            parentName: person?.parent_name ?? null,
            parentPhone: person?.parent_phone ?? null,
            schoolType: row.school_type ?? null,
            grade: row.grade ?? null,
            status: row.status,
            classIds: enrolled.map((item) => item.class_id),
            classNames: enrolled.map((item) => item.classes?.name || 'Unknown class'),
            billingMode: null,
            baseMonthlyFee: 0,
            hourlyRate: null,
            extraClassFee: 0,
        };
    });
}

async function loadAssignmentBookCatalogUncached(content: SchemaClient, academyId: string): Promise<AssignmentBookCatalogSummary[]> {
    const books = await loadAllRowsById<Row>((afterId, limit) => {
        let query = content
            .from('books')
            .select('id,book_key,title,subject,grade,metadata,academy_id')
            .or(`academy_id.is.null,academy_id.eq.${academyId}`)
            .order('id', { ascending: true })
            .limit(limit);
        if (afterId) query = query.gt('id', afterId);
        return query;
    }, 'Failed to load assignment books');

    const bookRows = books
        .filter((row) => row.metadata?.visibility === 'catalog')
        .sort((a, b) => {
            const titleOrder = String(a.title ?? '').localeCompare(String(b.title ?? ''), 'ko', { numeric: true });
            return titleOrder || String(a.id).localeCompare(String(b.id));
        });
    const bookIds = bookRows.map((row) => row.id);
    if (bookIds.length === 0) return [];

    const [unitRows, typeRows, problemRows] = await Promise.all([
        loadAllRowsById<Row>((afterId, limit) => {
            let query = content
                .from('units')
                .select('id,book_id,name,part_name,sort_order')
                .in('book_id', bookIds)
                .order('id', { ascending: true })
                .limit(limit);
            if (afterId) query = query.gt('id', afterId);
            return query;
        }, 'Failed to load units'),
        loadAllRowsById<Row>((afterId, limit) => {
            let query = content
                .from('problem_types')
                .select('id,book_id,unit_id,concept_id,name,sort_order')
                .in('book_id', bookIds)
                .order('id', { ascending: true })
                .limit(limit);
            if (afterId) query = query.gt('id', afterId);
            return query;
        }, 'Failed to load problem types'),
        loadAllRowsByOffset<Row>((from, to) => {
            return content
                .from('problems')
                .select('id,book_id,unit_id,problem_type_id,type_id,middle_unit:metadata->>middle_unit')
                .in('book_id', bookIds)
                .eq('verified', true)
                .eq('is_example', false)
                .order('id', { ascending: true })
                .range(from, to);
        }, 'Failed to load published assignment catalog facets', 1_000, 12),
    ]);

    const publishedBookIds = new Set<string>();
    const publishedUnitIds = new Set<string>();
    const publishedTypeIds = new Set<string>();
    const problemCountsByUnit = new Map<string, number>();
    const problemCountsByType = new Map<string, number>();
    const middleUnitsByUnit = new Map<string, Set<string>>();
    const middleUnitsByType = new Map<string, Set<string>>();
    const unassignedMiddleProblemCountsByUnit = new Map<string, number>();
    for (const row of problemRows) {
        if (row.book_id) publishedBookIds.add(String(row.book_id));
        const unitId = row.unit_id ? String(row.unit_id) : null;
        if (unitId) {
            publishedUnitIds.add(unitId);
            problemCountsByUnit.set(unitId, (problemCountsByUnit.get(unitId) || 0) + 1);
        }
        const typeId = row.problem_type_id || row.type_id;
        if (typeId) {
            const normalizedTypeId = String(typeId);
            publishedTypeIds.add(normalizedTypeId);
            problemCountsByType.set(normalizedTypeId, (problemCountsByType.get(normalizedTypeId) || 0) + 1);
        }
        const middleUnit = typeof row.middle_unit === 'string' ? row.middle_unit.trim() : '';
        if (!middleUnit && !typeId && unitId) {
            unassignedMiddleProblemCountsByUnit.set(
                unitId,
                (unassignedMiddleProblemCountsByUnit.get(unitId) || 0) + 1,
            );
        }
        if (middleUnit && unitId) {
            const unitMiddles = middleUnitsByUnit.get(unitId) || new Set<string>();
            unitMiddles.add(middleUnit);
            middleUnitsByUnit.set(unitId, unitMiddles);
        }
        if (middleUnit && typeId) {
            const normalizedTypeId = String(typeId);
            const typeMiddles = middleUnitsByType.get(normalizedTypeId) || new Set<string>();
            typeMiddles.add(middleUnit);
            middleUnitsByType.set(normalizedTypeId, typeMiddles);
        }
    }

    const units = unitRows.filter((row) => publishedUnitIds.has(String(row.id)));
    const types = typeRows.filter((row) => publishedTypeIds.has(String(row.id)));
    const unitsByBook = new Map<string, Row[]>();
    const typesByBook = new Map<string, Row[]>();
    for (const unit of units) {
        const rows = unitsByBook.get(unit.book_id) || [];
        rows.push(unit);
        unitsByBook.set(unit.book_id, rows);
    }
    for (const type of types) {
        const rows = typesByBook.get(type.book_id) || [];
        rows.push(type);
        typesByBook.set(type.book_id, rows);
    }

    return bookRows.filter((book) => publishedBookIds.has(String(book.id))).map((book) => {
        const unitSummaries: AssignmentUnitSummary[] = (unitsByBook.get(book.id) || [])
            .sort((a, b) => {
                const sortA = typeof a.sort_order === 'number' ? a.sort_order : Number.MAX_SAFE_INTEGER;
                const sortB = typeof b.sort_order === 'number' ? b.sort_order : Number.MAX_SAFE_INTEGER;
                if (sortA !== sortB) return sortA - sortB;

                return String(a.id).localeCompare(String(b.id));
            })
            .map((row) => ({
                id: row.id,
                name: row.name,
                partName: row.part_name ?? null,
                problemCount: problemCountsByUnit.get(String(row.id)) || 0,
                middleUnitNames: [...(middleUnitsByUnit.get(String(row.id)) || [])],
                unassignedMiddleProblemCount: unassignedMiddleProblemCountsByUnit.get(String(row.id)) || 0,
            }));
        const typeSummaries: AssignmentProblemTypeSummary[] = (typesByBook.get(book.id) || [])
            .sort((a, b) => {
                const sortA = typeof a.sort_order === 'number' ? a.sort_order : Number.MAX_SAFE_INTEGER;
                const sortB = typeof b.sort_order === 'number' ? b.sort_order : Number.MAX_SAFE_INTEGER;
                if (sortA !== sortB) return sortA - sortB;

                return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ko', { numeric: true });
            })
            .map((row) => ({
                id: row.id,
                unitId: row.unit_id ?? null,
                name: row.name,
                problemCount: problemCountsByType.get(String(row.id)) || 0,
                middleUnitNames: [...(middleUnitsByType.get(String(row.id)) || [])],
            }));

        return {
            id: book.id,
            bookKey: book.book_key,
            title: book.title,
            subject: book.subject ?? null,
            grade: book.grade ?? null,
            units: unitSummaries,
            problemTypes: typeSummaries,
        };
    });
}

const loadCachedAssignmentBookCatalog = unstable_cache(
    async (academyId: string) => {
        const client = createAdminClient();
        return loadAssignmentBookCatalogUncached(client.schema('content'), academyId);
    },
    ['assignment-book-catalog-v1'],
    { revalidate: 5 * 60 },
);

async function fetchAssignmentPeople(
    core: SchemaClient,
    studentIds: string[],
): Promise<Map<string, { name: string; personId: string }>> {
    const ids = uniqueStrings(studentIds);
    if (ids.length === 0) return new Map();
    const { data, error } = await core
        .from('students')
        .select('id,person_id')
        .in('id', ids);
    ensureNoError(error, 'Failed to load assignment students');
    const rows = (data || []) as Row[];
    const people = await fetchPeople(core, rows.map((row) => row.person_id));
    return new Map(rows.map((row) => {
        const person = people.get(row.person_id);
        return [row.id, {
            personId: row.person_id,
            name: person?.display_name || person?.full_name || 'Unknown student',
        }];
    }));
}

function classifyRecipient(
    requiredProblems: Set<string>,
    attempts: Row[],
    sessions: Row[],
): AssignmentStudentProgressStatus {
    if (requiredProblems.size === 0) {
        if (sessions.some((row) => row.submitted_at)) return 'completed';
        return attempts.length > 0 || sessions.length > 0 ? 'in_progress' : 'not_started';
    }
    const attemptedRequired = new Set(
        attempts
            .map((row) => row.problem_id as string)
            .filter((problemId) => requiredProblems.has(problemId)),
    );
    if (attemptedRequired.size === 0 && sessions.length === 0) return 'not_started';
    for (const problemId of requiredProblems) {
        if (!attemptedRequired.has(problemId)) return 'in_progress';
    }
    return 'completed';
}

function summarizeRecipients(recipients: AssignmentRecipientProgress[]): AssignmentProgressSummary {
    if (recipients.length === 0) return { ...EMPTY_PROGRESS };
    let completedCount = 0;
    let inProgressCount = 0;
    let attemptCount = 0;
    let correctAttemptCount = 0;
    let lastActivityAt: string | null = null;
    for (const recipient of recipients) {
        if (recipient.status === 'completed') completedCount += 1;
        else if (recipient.status === 'in_progress') inProgressCount += 1;
        attemptCount += recipient.attemptCount;
        correctAttemptCount += recipient.correctAttemptCount;
        if (recipient.lastActivityAt && (!lastActivityAt || recipient.lastActivityAt > lastActivityAt)) {
            lastActivityAt = recipient.lastActivityAt;
        }
    }
    const notStartedCount = recipients.length - completedCount - inProgressCount;
    return {
        targetStudentCount: recipients.length,
        notStartedCount,
        inProgressCount,
        completedCount,
        completionRate: percent(completedCount, recipients.length),
        attemptCount,
        correctAttemptCount,
        correctRate: accuracy(correctAttemptCount, attemptCount),
        lastActivityAt,
    };
}

function buildRecipientProgress(input: {
    recipients: Row[];
    items: Row[];
    attempts: Row[];
    sessions: Row[];
    studentNames: Map<string, { name: string; personId: string }>;
    classNames: Map<string, string>;
    fallbackClassByStudent: Map<string, string>;
}): AssignmentRecipientProgress[] {
    const requiredProblems = new Set(
        input.items
            .filter((row) => row.required !== false && row.problem_id)
            .map((row) => row.problem_id as string),
    );
    const attemptsByStudent = groupRowsBy(input.attempts, 'core_student_id');
    const sessionsByStudent = groupRowsBy(input.sessions, 'core_student_id');
    return input.recipients
        .filter((row) => row.active !== false)
        .map((recipient) => {
            const studentAttempts = attemptsByStudent.get(recipient.student_id) || [];
            const studentSessions = sessionsByStudent.get(recipient.student_id) || [];
            const attemptedProblemCount = new Set(
                studentAttempts
                    .map((row) => row.problem_id as string)
                    .filter((problemId) => requiredProblems.size === 0 || requiredProblems.has(problemId)),
            ).size;
            const correctAttemptCount = studentAttempts.filter((row) => row.correct === true).length;
            const classId = recipient.class_id || input.fallbackClassByStudent.get(recipient.student_id) || null;
            return {
                id: recipient.id,
                studentId: recipient.student_id,
                studentName: input.studentNames.get(recipient.student_id)?.name || 'Unknown student',
                classId,
                className: classId ? input.classNames.get(classId) ?? null : null,
                status: classifyRecipient(requiredProblems, studentAttempts, studentSessions),
                requiredProblemCount: requiredProblems.size,
                attemptedProblemCount,
                attemptCount: studentAttempts.length,
                correctAttemptCount,
                correctRate: accuracy(correctAttemptCount, studentAttempts.length),
                lastActivityAt: lastIso([
                    ...studentAttempts.map((row) => row.created_at as string | null),
                    ...studentSessions.map((row) => (row.submitted_at || row.started_at) as string | null),
                ]),
            };
        });
}

function buildClassProgress(
    recipients: AssignmentRecipientProgress[],
): AssignmentClassProgressSummary[] {
    const byClass = new Map<string, AssignmentRecipientProgress[]>();
    for (const recipient of recipients) {
        const key = recipient.classId || '__unassigned__';
        const list = byClass.get(key) || [];
        list.push(recipient);
        byClass.set(key, list);
    }
    return [...byClass.entries()]
        .map(([classId, rows]) => ({
            classId: classId === '__unassigned__' ? null : classId,
            className: rows[0]?.className || '개별 학생',
            ...summarizeRecipients(rows),
        }))
        .sort((a, b) => a.className.localeCompare(b.className, 'ko'));
}

async function loadFallbackClassByStudent(
    core: SchemaClient,
    studentIds: string[],
    allowedClassIds: Set<string> | null,
): Promise<Map<string, string>> {
    const ids = uniqueStrings(studentIds);
    if (ids.length === 0) return new Map();
    let query = core
        .from('class_students')
        .select('student_id,class_id,status,primary_class,joined_at')
        .in('student_id', ids)
        .eq('status', 'active')
        .order('primary_class', { ascending: false })
        .order('joined_at', { ascending: false });
    if (allowedClassIds && allowedClassIds.size > 0) query = query.in('class_id', [...allowedClassIds]);
    const { data, error } = await query;
    ensureNoError(error, 'Failed to load student fallback classes');
    const result = new Map<string, string>();
    for (const row of (data || []) as Row[]) {
        if (!result.has(row.student_id)) result.set(row.student_id, row.class_id);
    }
    return result;
}

async function loadAssignments(
    learning: SchemaClient,
    content: SchemaClient,
    core: SchemaClient,
    context: LmsRoleContext,
    allowedClassIds: Set<string> | null,
    options: { assignmentId?: string; limit?: number } = {},
): Promise<LearningAssignmentSummary[]> {
    let query = learning
        .from('assignments')
        .select('id,title,description,due_at,source_type,status,active,book_id,created_at')
        .eq('academy_id', context.academyId);
    if (options.assignmentId) query = query.eq('id', options.assignmentId);
    else query = query.order('created_at', { ascending: false }).limit(options.limit ?? 150);

    const { data, error } = await query;
    ensureNoError(error, 'Failed to load assignments');
    let rows = (data || []) as Row[];
    if (rows.length === 0) return [];

    const assignmentIds = rows.map((row) => row.id);
    const bookIds = uniqueStrings(rows.map((row) => row.book_id));
    const [targetResult, itemResult, recipientResult, sessionResult, attemptResult, bookResult] = await Promise.all([
        learning.from('assignment_targets').select('assignment_id,target_type,class_id,student_id,active').in('assignment_id', assignmentIds),
        learning.from('assignment_items').select('assignment_id,problem_id,required').in('assignment_id', assignmentIds),
        learning.from('assignment_recipients').select('id,assignment_id,student_id,class_id,active').in('assignment_id', assignmentIds),
        learning.from('sessions').select('assignment_id,core_student_id,started_at,submitted_at').in('assignment_id', assignmentIds),
        learning.from('attempts').select('assignment_id,core_student_id,problem_id,correct,created_at').in('assignment_id', assignmentIds),
        bookIds.length ? content.from('books').select('id,title').in('id', bookIds) : Promise.resolve({ data: [], error: null }),
    ]);
    ensureNoError(targetResult.error, 'Failed to load assignment targets');
    ensureNoError(itemResult.error, 'Failed to load assignment items');
    ensureNoError(recipientResult.error, 'Failed to load assignment recipients');
    ensureNoError(sessionResult.error, 'Failed to load assignment sessions');
    ensureNoError(attemptResult.error, 'Failed to load assignment attempts');
    ensureNoError(bookResult.error, 'Failed to load assignment books');

    const targets = (targetResult.data || []) as Row[];
    const items = (itemResult.data || []) as Row[];
    const recipients = (recipientResult.data || []) as Row[];
    const sessions = (sessionResult.data || []) as Row[];
    const attempts = (attemptResult.data || []) as Row[];
    const targetsByAssignment = groupRowsBy(targets, 'assignment_id');
    const recipientsByAssignment = groupRowsBy(recipients, 'assignment_id');
    const itemsByAssignment = groupRowsBy(items, 'assignment_id');
    const sessionsByAssignment = groupRowsBy(sessions, 'assignment_id');
    const attemptsByAssignment = groupRowsBy(attempts, 'assignment_id');
    const scoped = Boolean(allowedClassIds);
    const allowedStudentIds = await loadAllowedStudentIds(core, allowedClassIds);
    const allowedStudentSet = new Set(allowedStudentIds || []);

    if (scoped) {
        rows = rows.filter((assignment) => {
            const assignmentTargets = targetsByAssignment.get(assignment.id) || [];
            const assignmentRecipients = recipientsByAssignment.get(assignment.id) || [];
            return assignmentTargets.some((row) => (
                (row.class_id && allowedClassIds?.has(row.class_id))
                || (row.student_id && allowedStudentSet.has(row.student_id))
            )) || assignmentRecipients.some((row) => (
                (row.class_id && allowedClassIds?.has(row.class_id))
                || allowedStudentSet.has(row.student_id)
            ));
        });
    }
    const visibleIds = new Set(rows.map((row) => row.id));
    const visibleRecipients = recipients.filter((row) => visibleIds.has(row.assignment_id));
    const visibleTargets = targets.filter((row) => visibleIds.has(row.assignment_id));
    const classIds = uniqueStrings([
        ...visibleTargets.map((row) => row.class_id),
        ...visibleRecipients.map((row) => row.class_id),
    ]);
    const studentIds = uniqueStrings([
        ...visibleTargets.map((row) => row.student_id),
        ...visibleRecipients.map((row) => row.student_id),
    ]);
    const [classResult, studentNames, fallbackClassByStudent] = await Promise.all([
        classIds.length ? core.from('classes').select('id,name').in('id', classIds) : Promise.resolve({ data: [], error: null }),
        fetchAssignmentPeople(core, studentIds),
        loadFallbackClassByStudent(core, studentIds, allowedClassIds),
    ]);
    ensureNoError(classResult.error, 'Failed to load target class names');
    const classNames = new Map(((classResult.data || []) as Row[]).map((row) => [row.id, row.name]));
    const bookTitles = new Map(((bookResult.data || []) as Row[]).map((row) => [row.id, row.title]));

    return rows.map((assignment) => {
        const assignmentTargets = (targetsByAssignment.get(assignment.id) || []).filter((row) => row.active !== false);
        const recipientRows = (recipientsByAssignment.get(assignment.id) || []).filter((row) => row.active !== false);
        const assignmentItems = itemsByAssignment.get(assignment.id) || [];
        const recipientProgress = buildRecipientProgress({
            recipients: recipientRows,
            items: assignmentItems,
            attempts: attemptsByAssignment.get(assignment.id) || [],
            sessions: sessionsByAssignment.get(assignment.id) || [],
            studentNames,
            classNames,
            fallbackClassByStudent,
        });
        const classProgress = buildClassProgress(recipientProgress);
        const studentProgress = recipientProgress
            .sort((a, b) => (a.className || '').localeCompare(b.className || '', 'ko') || a.studentName.localeCompare(b.studentName, 'ko'));
        const classIdsForAssignment = uniqueStrings(classProgress.map((row) => row.classId));
        return {
            id: assignment.id,
            title: assignment.title,
            description: assignment.description ?? null,
            dueAt: assignment.due_at ?? null,
            sourceType: assignment.source_type === 'worksheet' ? 'worksheet' : 'content_scope',
            status: assignment.status,
            active: Boolean(assignment.active),
            bookTitle: assignment.book_id ? bookTitles.get(assignment.book_id) ?? null : null,
            problemCount: assignmentItems.length,
            targetLabels: assignmentTargets.map((row) => {
                if (row.target_type === 'class') return classNames.get(row.class_id) || 'Unknown class';
                return studentNames.get(row.student_id)?.name || 'Unknown student';
            }),
            classIds: classIdsForAssignment,
            classProgress,
            studentProgress,
            progress: summarizeRecipients(studentProgress),
            createdAt: assignment.created_at,
        };
    });
}

export async function loadLearningAssignmentsForContext(
    context: LmsRoleContext,
    options: { assignmentId?: string; limit?: number } = {},
): Promise<LearningAssignmentSummary[]> {
    const client = createAdminClient();
    const core = client.schema('core');
    const content = client.schema('content');
    const learning = client.schema('learning');
    const assignedClassIds = await loadAssignedClassIdsForContext(context);
    return loadAssignments(learning, content, core, context, assignedClassIds, options);
}

async function loadProblemProgress(
    content: SchemaClient,
    assignmentId: string,
    items: Row[],
    attempts: Row[],
): Promise<AssignmentProblemProgress[]> {
    const problemIds = uniqueStrings(items.map((row) => row.problem_id));
    if (problemIds.length === 0) return [];
    const { data: problemData, error } = await content
        .from('problems')
        .select('id,unit_id,concept_id,problem_type_id,type_id,page_printed,number')
        .in('id', problemIds);
    ensureNoError(error, 'Failed to load assignment problem progress');
    const problems = (problemData || []) as Row[];
    const unitIds = uniqueStrings(problems.map((row) => row.unit_id));
    const typeIds = uniqueStrings(problems.map((row) => row.problem_type_id || row.type_id));
    const [unitResult, typeResult] = await Promise.all([
        unitIds.length ? content.from('units').select('id,name').in('id', unitIds) : Promise.resolve({ data: [], error: null }),
        typeIds.length ? content.from('problem_types').select('id,name,concept_id').in('id', typeIds) : Promise.resolve({ data: [], error: null }),
    ]);
    ensureNoError(unitResult.error, 'Failed to load assignment problem units');
    ensureNoError(typeResult.error, 'Failed to load assignment problem types');
    const unitNames = new Map(((unitResult.data || []) as Row[]).map((row) => [row.id, row.name]));
    const types = (typeResult.data || []) as Row[];
    const typeNames = new Map(types.map((row) => [row.id, row.name]));
    const typeConceptIds = new Map(types.map((row) => [row.id, row.concept_id ?? null]));
    const conceptIds = uniqueStrings([
        ...problems.map((row) => row.concept_id),
        ...types.map((row) => row.concept_id),
    ]);
    const conceptResult = conceptIds.length
        ? await content.from('concepts').select('id,name').in('id', conceptIds)
        : { data: [], error: null };
    ensureNoError(conceptResult.error, 'Failed to load assignment problem concepts');
    const conceptNames = new Map(((conceptResult.data || []) as Row[]).map((row) => [row.id, row.name]));
    const attemptStatsByProblem = new Map<string, {
        attemptCount: number;
        correctAttemptCount: number;
        studentIds: Set<string>;
    }>();
    for (const attempt of attempts) {
        if (attempt.assignment_id !== assignmentId || !attempt.problem_id) continue;
        const stats = attemptStatsByProblem.get(attempt.problem_id) || {
            attemptCount: 0,
            correctAttemptCount: 0,
            studentIds: new Set<string>(),
        };
        stats.attemptCount += 1;
        if (attempt.correct === true) stats.correctAttemptCount += 1;
        if (attempt.core_student_id) stats.studentIds.add(attempt.core_student_id);
        attemptStatsByProblem.set(attempt.problem_id, stats);
    }

    return sortByProblemOrder(problems).map((problem) => {
        const stats = attemptStatsByProblem.get(problem.id);
        const attemptCount = stats?.attemptCount || 0;
        const correctAttemptCount = stats?.correctAttemptCount || 0;
        const typeId = problem.problem_type_id || problem.type_id || null;
        const typeName = typeId ? typeNames.get(typeId) ?? null : null;
        const conceptId = problem.concept_id || (typeId ? typeConceptIds.get(typeId) : null);
        const conceptName = conceptId ? conceptNames.get(conceptId) ?? null : null;
        const descriptor = typeName || conceptName;
        return {
            problemId: problem.id,
            label: assignmentProblemLabel(problem.page_printed, problem.number, descriptor),
            unitId: problem.unit_id ?? null,
            unitName: problem.unit_id ? unitNames.get(problem.unit_id) ?? null : null,
            typeName: descriptor,
            attemptCount,
            correctAttemptCount,
            correctRate: accuracy(correctAttemptCount, attemptCount),
            attemptedStudentCount: stats?.studentIds.size || 0,
        };
    });
}

export async function loadAssignmentDetail(
    context: LmsRoleContext,
    assignmentId: string,
): Promise<LearningAssignmentDetail> {
    const client = createAdminClient();
    const core = client.schema('core');
    const content = client.schema('content');
    const learning = client.schema('learning');
    const assignedClassIds = await loadAssignedClassIdsForContext(context);
    const summaries = await loadAssignments(learning, content, core, context, assignedClassIds, { assignmentId });
    const assignment = summaries[0];
    if (!assignment) throw new Error('Assignment access is not allowed.');

    const [recipientResult, itemResult, sessionResult, attemptResult, students] = await Promise.all([
        learning.from('assignment_recipients').select('id,assignment_id,student_id,class_id,active').eq('assignment_id', assignmentId),
        learning.from('assignment_items').select('assignment_id,problem_id,required').eq('assignment_id', assignmentId),
        learning.from('sessions').select('assignment_id,core_student_id,started_at,submitted_at').eq('assignment_id', assignmentId),
        learning.from('attempts').select('assignment_id,core_student_id,problem_id,correct,created_at').eq('assignment_id', assignmentId),
        loadStudents(core, context.academyId, assignedClassIds),
    ]);
    ensureNoError(recipientResult.error, 'Failed to load assignment detail recipients');
    ensureNoError(itemResult.error, 'Failed to load assignment detail items');
    ensureNoError(sessionResult.error, 'Failed to load assignment detail sessions');
    ensureNoError(attemptResult.error, 'Failed to load assignment detail attempts');

    const recipients = (recipientResult.data || []) as Row[];
    const items = (itemResult.data || []) as Row[];
    const sessions = (sessionResult.data || []) as Row[];
    const attempts = (attemptResult.data || []) as Row[];
    const activeRecipients = recipients.filter((row) => row.active !== false);
    const studentIds = uniqueStrings([
        ...activeRecipients.map((row) => row.student_id),
        ...students.map((row) => row.id),
    ]);
    const classIds = uniqueStrings([
        ...activeRecipients.map((row) => row.class_id),
        ...students.flatMap((row) => row.classIds),
    ]);
    const [studentNames, fallbackClassByStudent, classResult, problems] = await Promise.all([
        fetchAssignmentPeople(core, studentIds),
        loadFallbackClassByStudent(core, studentIds, assignedClassIds),
        classIds.length ? core.from('classes').select('id,name').in('id', classIds) : Promise.resolve({ data: [], error: null }),
        loadProblemProgress(content, assignmentId, items, attempts),
    ]);
    ensureNoError(classResult.error, 'Failed to load assignment detail class names');
    const classNames = new Map(((classResult.data || []) as Row[]).map((row) => [row.id, row.name]));
    const recipientProgress = buildRecipientProgress({
        recipients: activeRecipients,
        items,
        attempts,
        sessions,
        studentNames,
        classNames,
        fallbackClassByStudent,
    }).sort((a, b) => (a.className || '').localeCompare(b.className || '', 'ko') || a.studentName.localeCompare(b.studentName, 'ko'));
    const recipientStudentIds = new Set(activeRecipients.map((row) => row.student_id));
    const candidateStudents = students
        .filter((student) => student.status === 'active' && !recipientStudentIds.has(student.id))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

    return {
        assignment,
        recipients: recipientProgress,
        problems,
        candidateStudents,
    };
}

export async function loadAssignmentManagementData(
    context: LmsRoleContext,
): Promise<AssignmentManagementData> {
    const client = createAdminClient();
    const core = client.schema('core');
    const content = client.schema('content');
    const learning = client.schema('learning');
    const assignedClassIds = await loadAssignedClassIdsForContext(context);

    const [assignments, books, classes, students] = await Promise.all([
        loadAssignments(learning, content, core, context, assignedClassIds),
        loadCachedAssignmentBookCatalog(context.academyId),
        loadClasses(core, context.academyId, assignedClassIds),
        loadStudents(core, context.academyId, assignedClassIds),
    ]);

    return { assignments, books, classes, students, permissions: permissionsForContext(context) };
}

const loadCachedAssignmentManagementDataByActor = unstable_cache(
    async (context: LmsRoleContext) => loadAssignmentManagementData(context),
    ['assignment-management-page-data-v1'],
    { revalidate: 5 * 60 },
);

export async function loadCachedAssignmentManagementData(
    context: LmsRoleContext,
): Promise<AssignmentManagementData> {
    return loadCachedAssignmentManagementDataByActor(context);
}
