import { describe, expect, it } from 'vitest';
import type { AnalysisPlanRow, LearningAnalysisSnapshot } from './learning-analysis-mapper';
import {
  buildLearningAnalysisData,
  normalizeCreateLearningPlanInput,
  toCreatePlanContract,
} from './learning-analysis-mapper';

const CLASS_ID = '00000000-0000-4000-8000-000000000101';
const INCLUDED_STUDENT_ID = '00000000-0000-4000-8000-000000000102';
const EXCLUDED_STUDENT_ID = '00000000-0000-4000-8000-000000000103';
const SKILL_ID = '00000000-0000-4000-8000-000000000104';
const REVISION_ID = '00000000-0000-4000-8000-000000000105';
const ACTIVE_EXAM_ID = '00000000-0000-4000-8000-000000000106';
const DRAFT_PRIMARY_ID = '00000000-0000-4000-8000-000000000107';
const COMPLETED_PRIMARY_ID = '00000000-0000-4000-8000-000000000108';
const ARCHIVED_SUPPLEMENTAL_ID = '00000000-0000-4000-8000-000000000109';

function plan(overrides: Partial<AnalysisPlanRow> & Pick<AnalysisPlanRow, 'id' | 'name'>): AnalysisPlanRow {
  const { id, name, ...rest } = overrides;
  return {
    id,
    classId: CLASS_ID,
    name,
    planType: 'study_track',
    trackKind: 'current',
    pathRole: 'primary',
    pathPurpose: 'current',
    status: 'active',
    targetBand: 2,
    maintenanceIntervalDays: 21,
    examDate: null,
    recheckIntervalDays: null,
    taxonomyRevisionId: REVISION_ID,
    ...rest,
  };
}

describe('learning analysis lifecycle mapper', () => {
  it('keeps every path state visible while evaluating only active paths and excluding opted-out students', () => {
    const plans: AnalysisPlanRow[] = [
      plan({
        id: ACTIVE_EXAM_ID,
        name: '진행 중 시험 경로',
        planType: 'exam',
        trackKind: null,
        pathRole: 'supplemental',
        pathPurpose: 'exam',
        examDate: '2026-08-01',
        maintenanceIntervalDays: null,
        recheckIntervalDays: 21,
      }),
      plan({ id: DRAFT_PRIMARY_ID, name: '다음 대표 경로', status: 'draft' }),
      plan({ id: COMPLETED_PRIMARY_ID, name: '완료 대표 경로', status: 'completed' }),
      plan({
        id: ARCHIVED_SUPPLEMENTAL_ID,
        name: '보관 보조 경로',
        status: 'archived',
        pathRole: 'supplemental',
        pathPurpose: 'review',
        trackKind: 'maintenance',
      }),
    ];
    const snapshot: LearningAnalysisSnapshot = {
      asOfDate: '2026-07-12',
      selectedExamPlanId: ACTIVE_EXAM_ID,
      classes: [{ id: CLASS_ID, name: '중2 수학 A' }],
      students: [
        { id: INCLUDED_STUDENT_ID, name: '포함 학생', classIds: [CLASS_ID] },
        { id: EXCLUDED_STUDENT_ID, name: '제외 학생', classIds: [CLASS_ID] },
      ],
      skills: [{ id: SKILL_ID, name: '일차함수', unitLabel: '함수', sortOrder: 1 }],
      catalogSkillIds: [SKILL_ID],
      materials: [],
      plans,
      scopes: plans.map((item) => ({ planId: item.id, skillId: SKILL_ID, targetBand: null, sortOrder: 1 })),
      planMaterials: [],
      studentOverrides: [{
        planId: ACTIVE_EXAM_ID,
        studentId: EXCLUDED_STUDENT_ID,
        included: false,
        targetBand: 2,
        maintenanceIntervalDays: null,
        recheckIntervalDays: null,
      }],
      tags: [],
      attempts: [],
      problems: [],
    };

    const result = buildLearningAnalysisData(snapshot);
    const pathsById = new Map(result.paths.map((item) => [item.id, item]));

    expect(pathsById.get(ACTIVE_EXAM_ID)).toMatchObject({ status: 'active', role: 'supplemental' });
    expect(pathsById.get(DRAFT_PRIMARY_ID)).toMatchObject({ status: 'draft', role: 'primary' });
    expect(pathsById.get(COMPLETED_PRIMARY_ID)).toMatchObject({ status: 'completed', role: 'primary' });
    expect(pathsById.get(ARCHIVED_SUPPLEMENTAL_ID)).toMatchObject({ status: 'archived', role: 'supplemental' });
    expect(pathsById.get(DRAFT_PRIMARY_ID)).toMatchObject({ dueStudentCount: 0, actionCount: 0 });
    expect(pathsById.get(COMPLETED_PRIMARY_ID)).toMatchObject({ dueStudentCount: 0, actionCount: 0 });
    expect(result.examStudents.map((student) => student.studentId)).toEqual([INCLUDED_STUDENT_ID]);
  });

  it('uses classId at the application boundary and preserves include/exclude flags in the database contract', () => {
    const normalized = normalizeCreateLearningPlanInput({
      kind: 'advance',
      role: 'primary',
      classId: CLASS_ID,
      name: '고1 선행',
      targetBand: 3,
      examDate: null,
      maintenanceIntervalDays: 14,
      scopeSkillIds: [SKILL_ID],
      materialBookIds: [],
      studentOverrides: [
        { studentId: INCLUDED_STUDENT_ID, included: true, targetBand: 4 },
        { studentId: EXCLUDED_STUDENT_ID, included: false, targetBand: 3 },
      ],
    }, '2026-07-12');

    expect(normalized).toHaveProperty('classId', CLASS_ID);
    expect(normalized).not.toHaveProperty('classroomId');
    expect(toCreatePlanContract(normalized)).toMatchObject({
      class_id: CLASS_ID,
      path_role: 'primary',
      path_purpose: 'advance',
      student_overrides: [
        { student_id: INCLUDED_STUDENT_ID, included: true, target_challenge_band: 4 },
        { student_id: EXCLUDED_STUDENT_ID, included: false, target_challenge_band: 3 },
      ],
    });
  });
});
