import 'server-only';

import type {
    AssignmentBookSummary,
    AssignmentManagementData,
    AssignmentProblemSummary,
    AssignmentProblemTypeSummary,
    AssignmentUnitSummary,
    LearningAssignmentSummary,
} from '@/features/lms/types';
import { createAdminClient } from '@/lib/supabase/admin';
import type { LmsRoleContext } from './auth';

type Row = Record<string, any>;
type LmsAdminClient = ReturnType<typeof createAdminClient>;
type SchemaClient = ReturnType<LmsAdminClient['schema']>;

function ensureNoError(error: { message?: string } | null, context: string) {
    if (error) {
        throw new Error(`${context}: ${error.message ?? 'Unknown Supabase error'}`);
    }
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
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

async function loadClasses(core: SchemaClient, academyId: string) {
    const { data, error } = await core
        .from('classes')
        .select('id,name,grade,active')
        .eq('academy_id', academyId)
        .order('name');
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

async function loadStudents(core: SchemaClient, academyId: string) {
    const { data, error } = await core
        .from('students')
        .select('id,person_id,status,school_type,grade')
        .eq('academy_id', academyId)
        .order('created_at', { ascending: false });
    ensureNoError(error, 'Failed to load students');

    const rows = (data || []) as Row[];
    const people = await fetchPeople(core, rows.map((row) => row.person_id));
    const { data: classRows, error: classError } = await core
        .from('class_students')
        .select('student_id,class_id,status,classes(id,name)')
        .in('student_id', rows.map((row) => row.id));
    ensureNoError(classError, 'Failed to load student classes');

    const byStudent = new Map<string, Row[]>();
    for (const row of (classRows || []) as Row[]) {
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

async function loadAssignmentBooks(content: SchemaClient, academyId: string): Promise<AssignmentBookSummary[]> {
    const { data: books, error: bookError } = await content
        .from('books')
        .select('id,book_key,title,subject,grade,metadata,academy_id')
        .or(`academy_id.is.null,academy_id.eq.${academyId}`)
        .order('title');
    ensureNoError(bookError, 'Failed to load assignment books');

    const bookRows = ((books || []) as Row[]).filter((row) => row.metadata?.visibility !== 'assignment_hidden');
    const bookIds = bookRows.map((row) => row.id);
    if (bookIds.length === 0) return [];

    const [unitResult, typeResult, problemResult] = await Promise.all([
        content.from('units').select('id,book_id,name,part_name,sort_order').in('book_id', bookIds).order('sort_order'),
        content.from('problem_types').select('id,book_id,unit_id,name,sort_order').in('book_id', bookIds).order('sort_order'),
        content
            .from('problems')
            .select('id,book_id,unit_id,problem_type_id,type_id,page_printed,number,is_example')
            .in('book_id', bookIds)
            .eq('is_example', false)
            .order('page_printed'),
    ]);
    ensureNoError(unitResult.error, 'Failed to load units');
    ensureNoError(typeResult.error, 'Failed to load problem types');
    ensureNoError(problemResult.error, 'Failed to load problems');

    const units = (unitResult.data || []) as Row[];
    const types = (typeResult.data || []) as Row[];
    const problems = (problemResult.data || []) as Row[];
    const typeName = new Map(types.map((row) => [row.id, row.name]));

    return bookRows.map((book) => {
        const bookProblems = problems.filter((row) => row.book_id === book.id);
        const problemCountsByUnit = new Map<string, number>();
        const problemCountsByType = new Map<string, number>();
        for (const problem of bookProblems) {
            problemCountsByUnit.set(problem.unit_id, (problemCountsByUnit.get(problem.unit_id) || 0) + 1);
            const typeId = problem.problem_type_id || problem.type_id || null;
            if (typeId) problemCountsByType.set(typeId, (problemCountsByType.get(typeId) || 0) + 1);
        }

        const unitSummaries: AssignmentUnitSummary[] = units
            .filter((row) => row.book_id === book.id)
            .map((row) => ({
                id: row.id,
                name: row.name,
                partName: row.part_name ?? null,
                problemCount: problemCountsByUnit.get(row.id) || 0,
            }));
        const typeSummaries: AssignmentProblemTypeSummary[] = types
            .filter((row) => row.book_id === book.id && (problemCountsByType.get(row.id) || 0) > 0)
            .map((row) => ({
                id: row.id,
                unitId: row.unit_id ?? null,
                name: row.name,
                problemCount: problemCountsByType.get(row.id) || 0,
            }));
        const problemSummaries: AssignmentProblemSummary[] = bookProblems.map((row) => {
            const typeId = row.problem_type_id || row.type_id || null;
            return {
                id: row.id,
                bookId: row.book_id,
                unitId: row.unit_id,
                problemTypeId: typeId,
                number: String(row.number),
                pagePrinted: Number(row.page_printed),
                typeName: typeId ? typeName.get(typeId) ?? null : null,
            };
        });

        return {
            id: book.id,
            bookKey: book.book_key,
            title: book.title,
            subject: book.subject ?? null,
            grade: book.grade ?? null,
            units: unitSummaries,
            problemTypes: typeSummaries,
            problems: problemSummaries,
        };
    });
}

async function loadAssignments(
    learning: SchemaClient,
    content: SchemaClient,
    core: SchemaClient,
    academyId: string,
): Promise<LearningAssignmentSummary[]> {
    const { data, error } = await learning
        .from('assignments')
        .select('id,title,description,due_at,source_type,status,active,book_id,created_at')
        .eq('academy_id', academyId)
        .order('created_at', { ascending: false })
        .limit(100);
    ensureNoError(error, 'Failed to load assignments');
    const rows = (data || []) as Row[];
    if (rows.length === 0) return [];

    const assignmentIds = rows.map((row) => row.id);
    const bookIds = uniqueStrings(rows.map((row) => row.book_id));
    const [targetResult, itemResult, bookResult] = await Promise.all([
        learning.from('assignment_targets').select('assignment_id,target_type,class_id,student_id,active').in('assignment_id', assignmentIds),
        learning.from('assignment_items').select('assignment_id,problem_id').in('assignment_id', assignmentIds),
        bookIds.length ? content.from('books').select('id,title').in('id', bookIds) : Promise.resolve({ data: [], error: null }),
    ]);
    ensureNoError(targetResult.error, 'Failed to load assignment targets');
    ensureNoError(itemResult.error, 'Failed to load assignment items');
    ensureNoError(bookResult.error, 'Failed to load assignment books');

    const targets = (targetResult.data || []) as Row[];
    const classIds = uniqueStrings(targets.map((row) => row.class_id));
    const studentIds = uniqueStrings(targets.map((row) => row.student_id));
    const [classResult, studentResult] = await Promise.all([
        classIds.length ? core.from('classes').select('id,name').in('id', classIds) : Promise.resolve({ data: [], error: null }),
        studentIds.length ? core.from('students').select('id,person_id').in('id', studentIds) : Promise.resolve({ data: [], error: null }),
    ]);
    ensureNoError(classResult.error, 'Failed to load target class names');
    ensureNoError(studentResult.error, 'Failed to load target students');
    const people = await fetchPeople(core, ((studentResult.data || []) as Row[]).map((row) => row.person_id));
    const classNames = new Map(((classResult.data || []) as Row[]).map((row) => [row.id, row.name]));
    const studentNames = new Map(((studentResult.data || []) as Row[]).map((row) => {
        const person = people.get(row.person_id);
        return [row.id, person?.display_name || person?.full_name || 'Unknown student'];
    }));
    const bookTitles = new Map(((bookResult.data || []) as Row[]).map((row) => [row.id, row.title]));

    return rows.map((assignment) => {
        const assignmentTargets = targets.filter((row) => row.assignment_id === assignment.id && row.active !== false);
        return {
            id: assignment.id,
            title: assignment.title,
            description: assignment.description ?? null,
            dueAt: assignment.due_at ?? null,
            sourceType: assignment.source_type === 'worksheet' ? 'worksheet' : 'content_scope',
            status: assignment.status,
            active: Boolean(assignment.active),
            bookTitle: assignment.book_id ? bookTitles.get(assignment.book_id) ?? null : null,
            problemCount: ((itemResult.data || []) as Row[]).filter((row) => row.assignment_id === assignment.id).length,
            targetLabels: assignmentTargets.map((row) => {
                if (row.target_type === 'class') return classNames.get(row.class_id) || 'Unknown class';
                return studentNames.get(row.student_id) || 'Unknown student';
            }),
            createdAt: assignment.created_at,
        };
    });
}

export async function loadAssignmentManagementData(
    context: LmsRoleContext,
): Promise<AssignmentManagementData> {
    const client = createAdminClient();
    const core = client.schema('core');
    const content = client.schema('content');
    const learning = client.schema('learning');
    const academyId = context.academyId;

    const [assignments, books, classes, students] = await Promise.all([
        loadAssignments(learning, content, core, academyId),
        loadAssignmentBooks(content, academyId),
        loadClasses(core, academyId),
        loadStudents(core, academyId),
    ]);

    return { assignments, books, classes, students };
}
