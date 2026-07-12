import 'server-only';

import { requiresAssignedClassScope } from '@/core/auth/roles';
import { createAdminClient } from '@/lib/supabase/admin';
import { LmsAuthError, type LmsRoleContext } from './auth';
import { toSeoulDate } from './seoul-date';

type Row = Record<string, any>;
type LmsAdminClient = ReturnType<typeof createAdminClient>;
type SchemaClient = ReturnType<LmsAdminClient['schema']>;

export interface AssignedClassAccessInput {
    classId?: string | null;
    ruleId?: string | null;
    occurrenceId?: string | null;
    instructorId?: string | null;
}

export type ClassOperationAccess = 'manager' | 'durable_operator' | 'occurrence_participant' | 'none';

export interface ClassAccessFacts {
    classActive: boolean;
    ruleMatchesClass: boolean;
    occurrenceMatchesClass: boolean;
    durableAssignment: boolean;
    defaultInstructor: boolean;
    occurrenceParticipant: boolean;
}

function forbidden(message = 'Only assigned classes can be changed by this role.'): never {
    throw new LmsAuthError(message, 403);
}

export function resolveClassOperationAccess(
    role: LmsRoleContext['role'],
    facts: ClassAccessFacts,
): ClassOperationAccess {
    if (!requiresAssignedClassScope(role)) return 'manager';
    if (!facts.classActive || !facts.ruleMatchesClass || !facts.occurrenceMatchesClass) return 'none';
    if (facts.durableAssignment || facts.defaultInstructor) return 'durable_operator';
    if (facts.occurrenceParticipant) return 'occurrence_participant';
    return 'none';
}

async function loadActiveStaffId(core: SchemaClient, context: LmsRoleContext): Promise<string> {
    const { data, error } = await core
        .from('staff_members')
        .select('id')
        .eq('academy_id', context.academyId)
        .eq('person_id', context.personId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    const staffId = (data as Row | null)?.id;
    if (typeof staffId !== 'string' || staffId.length === 0) forbidden();
    return staffId;
}

export async function loadClassOperationAccess(
    context: LmsRoleContext,
    input: AssignedClassAccessInput,
): Promise<ClassOperationAccess> {
    if (!requiresAssignedClassScope(context.role)) return 'manager';

    const classId = input.classId;
    if (!classId) return 'none';

    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const staffId = await loadActiveStaffId(core, context);
    const currentDate = toSeoulDate(new Date());

    const [
        classResult,
        classAssignmentResult,
        profileResult,
        ruleResult,
        occurrenceResult,
        occurrenceParticipantResult,
    ] = await Promise.all([
        core
            .from('classes')
            .select('id,active')
            .eq('academy_id', context.academyId)
            .eq('id', classId)
            .maybeSingle(),
        lms
            .from('class_instructors')
            .select('class_id')
            .eq('academy_id', context.academyId)
            .eq('class_id', classId)
            .eq('instructor_staff_id', staffId)
            .eq('active', true)
            .lte('started_on', currentDate)
            .or(`ended_on.is.null,ended_on.gte.${currentDate}`)
            .limit(1)
            .maybeSingle(),
        lms
            .from('class_profiles')
            .select('class_id,default_instructor_staff_id,status')
            .eq('academy_id', context.academyId)
            .eq('class_id', classId)
            .maybeSingle(),
        input.ruleId
            ? lms
                .from('class_schedule_rules')
                .select('id,class_id')
                .eq('academy_id', context.academyId)
                .eq('id', input.ruleId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        input.occurrenceId
            ? lms
                .from('lesson_occurrences')
                .select('id,class_id,instructor_staff_id,substitute_staff_id')
                .eq('academy_id', context.academyId)
                .eq('id', input.occurrenceId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        input.occurrenceId
            ? lms
                .from('lesson_occurrence_instructors')
                .select('occurrence_id')
                .eq('academy_id', context.academyId)
                .eq('occurrence_id', input.occurrenceId)
                .eq('instructor_staff_id', staffId)
                .limit(1)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
    ]);

    for (const result of [
        classResult,
        classAssignmentResult,
        profileResult,
        ruleResult,
        occurrenceResult,
        occurrenceParticipantResult,
    ]) {
        if (result.error) throw result.error;
    }

    const classRow = classResult.data as Row | null;
    const classAssignment = classAssignmentResult.data as Row | null;
    const profile = profileResult.data as Row | null;
    const rule = ruleResult.data as Row | null;
    const occurrence = occurrenceResult.data as Row | null;
    const occurrenceParticipant = occurrenceParticipantResult.data as Row | null;

    return resolveClassOperationAccess(context.role, {
        classActive: Boolean(classRow?.id && classRow.active),
        ruleMatchesClass: !input.ruleId || Boolean(rule?.id && rule.class_id === classId),
        occurrenceMatchesClass: !input.occurrenceId || Boolean(occurrence?.id && occurrence.class_id === classId),
        durableAssignment: Boolean(classAssignment?.class_id),
        defaultInstructor: Boolean(
            profile?.status === 'active'
            && profile.default_instructor_staff_id === staffId,
        ),
        occurrenceParticipant: Boolean(
            input.occurrenceId
            && occurrence?.id
            && (
                occurrenceParticipant?.occurrence_id
                || occurrence.instructor_staff_id === staffId
                || occurrence.substitute_staff_id === staffId
            ),
        ),
    });
}

export async function assertDurableClassOperatorAccess(
    context: LmsRoleContext,
    input: AssignedClassAccessInput,
): Promise<void> {
    const access = await loadClassOperationAccess(context, input);
    if (access !== 'manager' && access !== 'durable_operator') {
        forbidden('Only a regularly assigned class instructor can change class structure.');
    }
}

export async function assertOccurrenceStatusAccess(
    context: LmsRoleContext,
    input: AssignedClassAccessInput,
): Promise<ClassOperationAccess> {
    const access = await loadClassOperationAccess(context, input);
    if (access === 'none') forbidden('Only a class operator or this lesson participant can update status, notes, or attendance.');
    return access;
}

/**
 * Backward-compatible name for class-wide operations. Occurrence-only access
 * must opt in through assertOccurrenceStatusAccess instead.
 */
export async function assertAssignedClassAccess(
    context: LmsRoleContext,
    input: AssignedClassAccessInput,
): Promise<void> {
    await assertDurableClassOperatorAccess(context, input);
}
