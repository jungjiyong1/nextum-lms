import type {
  ClassSummary,
  ScheduleEntryKind,
  ScheduleItem,
  ScheduleMutationInput,
  ScheduleParticipant,
  StaffSummary,
} from '../types';
import { minutesFromTime, type LessonSpecialStatusSelection } from './schedule-utils';

export interface ScheduleParticipantDraft {
  instructorId: string;
  participationKind: ScheduleParticipant['participationKind'];
  payableMinutes: string;
  payableMinutesCustomized: boolean;
  replacesInstructorId: string;
}

export function scheduleDurationMinutes(startTime: string, endTime: string): number {
  return Math.max(0, minutesFromTime(endTime) - minutesFromTime(startTime));
}

export function suggestedScheduleInstructorIds(
  classId: string,
  classes: ClassSummary[],
  staff: StaffSummary[],
): string[] {
  const activeStaff = staff.filter((row) => row.status === 'active');
  const selectedClass = classes.find((row) => row.id === classId);
  const normalizedClassInstructorIds = [...new Set(
    (selectedClass?.instructorIds?.length
      ? selectedClass.instructorIds
      : selectedClass?.defaultInstructorId ? [selectedClass.defaultInstructorId] : [])
      .filter((id) => activeStaff.some((row) => row.id === id)),
  )];
  if (normalizedClassInstructorIds.length === 1) return normalizedClassInstructorIds;
  if (normalizedClassInstructorIds.length > 1) return [];

  const assignedStaff = activeStaff.filter((row) => row.classIds?.includes(classId));
  if (assignedStaff.length === 1) return [assignedStaff[0].id];
  if (assignedStaff.length > 1) return [];

  const defaultInstructorId = selectedClass?.defaultInstructorId;
  return defaultInstructorId && activeStaff.some((row) => row.id === defaultInstructorId)
    ? [defaultInstructorId]
    : [];
}

export function buildScheduleParticipantPayload(
  drafts: ScheduleParticipantDraft[],
  specialStatus: LessonSpecialStatusSelection,
  durationMinutes: number,
): NonNullable<ScheduleMutationInput['participants']> {
  return drafts.map((draft) => {
    const rawPayableMinutes = Number(draft.payableMinutes);
    const normalizedPayableMinutes = Number.isFinite(rawPayableMinutes)
      ? Math.min(durationMinutes, Math.max(0, Math.round(rawPayableMinutes)))
      : 0;
    const participationKind = specialStatus === 'makeup'
      ? draft.participationKind === 'assistant' ? 'assistant' : 'makeup'
      : specialStatus === 'substitute'
        ? draft.participationKind
        : draft.participationKind === 'assistant' ? 'assistant' : 'regular';

    return {
      instructorId: draft.instructorId,
      participationKind,
      payableMinutes: specialStatus === 'cancelled' ? 0 : normalizedPayableMinutes,
      replacesInstructorId: participationKind === 'substitute'
        ? draft.replacesInstructorId || null
        : null,
    };
  });
}

export function buildScheduleInstructorMutationFields(
  drafts: ScheduleParticipantDraft[],
  specialStatus: LessonSpecialStatusSelection,
  durationMinutes: number,
  entryKind: ScheduleEntryKind,
): Pick<ScheduleMutationInput, 'instructorId' | 'instructorIds' | 'participants' | 'substituteInstructorId'> {
  const participants = buildScheduleParticipantPayload(drafts, specialStatus, durationMinutes);
  const instructorIds = participants.map((participant) => participant.instructorId);
  const substituteParticipant = participants.find((participant) => participant.participationKind === 'substitute');
  return {
    instructorId: instructorIds[0] || null,
    instructorIds,
    participants: entryKind === 'single' ? participants : undefined,
    substituteInstructorId: entryKind === 'single' && specialStatus === 'substitute'
      ? substituteParticipant?.instructorId || null
      : null,
  };
}

export function scheduleInstructorNames(item: ScheduleItem): string {
  const participantNames = [...new Set((item.instructors || [])
    .map((participant) => participant.instructorName)
    .filter((name): name is string => Boolean(name)))];
  return participantNames.length > 0
    ? participantNames.join(', ')
    : item.instructorName || '강사 미지정';
}
