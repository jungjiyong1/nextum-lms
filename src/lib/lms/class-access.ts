import 'server-only';

import { requiresAssignedClassScope } from '@/core/auth/roles';
import { createAdminClient } from '@/lib/supabase/admin';
import { LmsAuthError, type LmsRoleContext } from './auth';

type Row = Record<string, any>;
type LmsAdminClient = ReturnType<typeof createAdminClient>;
type SchemaClient = ReturnType<LmsAdminClient['schema']>;

export interface AssignedClassAccessInput {
    classId?: string | null;
    ruleId?: string | null;
    occurrenceId?: string | null;
    instructorId?: string | null;
}

function forbidden(): never {
    throw new LmsAuthError('Only assigned classes can be changed by this role.', 403);
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

export async function assertAssignedClassAccess(
    context: LmsRoleContext,
    input: AssignedClassAccessInput,
): Promise<void> {
    if (!requiresAssignedClassScope(context.role)) return;

    const classId = input.classId;
    if (!classId) forbidden();

    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const staffId = await loadActiveStaffId(core, context);

    if (input.instructorId && input.instructorId !== staffId) forbidden();

    const [profileResult, ruleResult, occurrenceResult, assignedRuleResult] = await Promise.all([
        lms
            .from('class_profiles')
            .select('class_id,default_instructor_staff_id')
            .eq('academy_id', context.academyId)
            .eq('class_id', classId)
            .maybeSingle(),
        input.ruleId
            ? lms
                .from('class_schedule_rules')
                .select('id,class_id,instructor_staff_id')
                .eq('academy_id', context.academyId)
                .eq('id', input.ruleId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        input.occurrenceId
            ? lms
                .from('lesson_occurrences')
                .select('id,class_id,rule_id,instructor_staff_id,substitute_staff_id')
                .eq('academy_id', context.academyId)
                .eq('id', input.occurrenceId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        lms
            .from('class_schedule_rules')
            .select('id')
            .eq('academy_id', context.academyId)
            .eq('class_id', classId)
            .eq('instructor_staff_id', staffId)
            .eq('active', true)
            .limit(1)
            .maybeSingle(),
    ]);

    for (const result of [profileResult, ruleResult, occurrenceResult, assignedRuleResult]) {
        if (result.error) throw result.error;
    }

    const profile = profileResult.data as Row | null;
    const rule = ruleResult.data as Row | null;
    const occurrence = occurrenceResult.data as Row | null;
    const assignedRule = assignedRuleResult.data as Row | null;

    if (!profile?.class_id) forbidden();
    if (rule && rule.class_id !== classId) forbidden();
    if (occurrence && occurrence.class_id !== classId) forbidden();

    const classDefaultMatches = profile.default_instructor_staff_id === staffId;
    const ruleMatches = Boolean(
        rule && (rule.instructor_staff_id === staffId || (!rule.instructor_staff_id && classDefaultMatches)),
    );
    const occurrenceMatches = Boolean(
        occurrence && (
            occurrence.instructor_staff_id === staffId
            || occurrence.substitute_staff_id === staffId
            || (!occurrence.instructor_staff_id && classDefaultMatches)
            || (!occurrence.instructor_staff_id && occurrence.rule_id && ruleMatches)
        ),
    );
    const anyAssignedRuleMatches = Boolean(assignedRule?.id);

    if (!classDefaultMatches && !ruleMatches && !occurrenceMatches && !anyAssignedRuleMatches) {
        forbidden();
    }
}
