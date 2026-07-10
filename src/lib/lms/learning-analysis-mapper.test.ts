import { describe, expect, it } from 'vitest';
import {
    buildLearningAnalysisData,
    LearningAnalysisValidationError,
    normalizeCreateLearningPlanInput,
    toCreatePlanContract,
    toSeoulDate,
    type LearningAnalysisSnapshot,
} from './learning-analysis-mapper';

const CLASS_ID = '00000000-0000-4000-8000-000000000001';
const STUDENT_ID = '00000000-0000-4000-8000-000000000002';
const SKILL_ID = '00000000-0000-4000-8000-000000000003';
const GAP_SKILL_ID = '00000000-0000-4000-8000-000000000004';
const TRACK_ID = '00000000-0000-4000-8000-000000000005';
const EXAM_ID = '00000000-0000-4000-8000-000000000006';
const BOOK_ID = '00000000-0000-4000-8000-000000000007';
const REVISION_ID = '00000000-0000-4000-8000-000000000008';

describe('learning analysis plan validation', () => {
    it('accepts a bookless study track and builds the database contract', () => {
        const normalized = normalizeCreateLearningPlanInput({
            kind: 'maintenance',
            classroomId: CLASS_ID,
            name: ' 2-2 유지 복습 ',
            targetBand: 2,
            examDate: null,
            maintenanceIntervalDays: 14,
            scopeSkillIds: [SKILL_ID, SKILL_ID],
            materialBookIds: [],
            studentOverrides: [{ studentId: STUDENT_ID, targetBand: 3 }],
        }, '2026-07-11');

        expect(normalized.materialBookIds).toEqual([]);
        expect(normalized.scopeSkillIds).toEqual([SKILL_ID]);
        expect(toCreatePlanContract(normalized)).toMatchObject({
            plan_type: 'study_track',
            track_kind: 'maintenance',
            maintenance_interval_days: 14,
            material_book_ids: [],
            student_overrides: [{
                student_id: STUDENT_ID,
                target_challenge_band: 3,
            }],
        });
    });

    it('rejects a past exam and an empty scope', () => {
        expect(() => normalizeCreateLearningPlanInput({
            kind: 'exam',
            classroomId: CLASS_ID,
            name: '중간고사',
            targetBand: 2,
            examDate: '2026-07-10',
            maintenanceIntervalDays: null,
            scopeSkillIds: [],
            materialBookIds: [],
        }, '2026-07-11')).toThrow(LearningAnalysisValidationError);
    });

    it('rejects duplicate or invalid student target overrides', () => {
        expect(() => normalizeCreateLearningPlanInput({
            kind: 'maintenance',
            classroomId: CLASS_ID,
            name: '복습',
            targetBand: 2,
            maintenanceIntervalDays: 21,
            scopeSkillIds: [SKILL_ID],
            materialBookIds: [],
            studentOverrides: [
                { studentId: STUDENT_ID, targetBand: 2 },
                { studentId: STUDENT_ID, targetBand: 3 },
            ],
        }, '2026-07-11')).toThrow('중복');
    });

    it('uses Asia/Seoul rather than a UTC date slice', () => {
        expect(toSeoulDate('2026-07-10T15:30:00.000Z')).toBe('2026-07-11');
    });
});

describe('learning analysis projection', () => {
    it('keeps content gaps separate and deduplicates student-skill actions across plans', () => {
        const snapshot: LearningAnalysisSnapshot = {
            asOfDate: '2026-07-11',
            selectedExamPlanId: EXAM_ID,
            classrooms: [{ id: CLASS_ID, name: '중2 A반' }],
            students: [{ id: STUDENT_ID, name: '김학생', classIds: [CLASS_ID] }],
            skills: [
                { id: SKILL_ID, name: '삼각형의 성질', unitLabel: '중2 · 2학기', sortOrder: 1 },
                { id: GAP_SKILL_ID, name: '평행사변형', unitLabel: '중2 · 2학기', sortOrder: 2 },
            ],
            catalogSkillIds: [SKILL_ID, GAP_SKILL_ID],
            materials: [{ id: BOOK_ID, name: '개념서', description: '중2' }],
            plans: [
                {
                    id: TRACK_ID,
                    classroomId: CLASS_ID,
                    name: '현행 학습',
                    planType: 'study_track',
                    trackKind: 'current',
                    targetBand: 2,
                    maintenanceIntervalDays: 21,
                    examDate: null,
                    recheckIntervalDays: null,
                    taxonomyRevisionId: REVISION_ID,
                },
                {
                    id: EXAM_ID,
                    classroomId: CLASS_ID,
                    name: '2학기 중간고사',
                    planType: 'exam',
                    trackKind: null,
                    targetBand: 2,
                    maintenanceIntervalDays: null,
                    examDate: '2026-08-01',
                    recheckIntervalDays: 21,
                    taxonomyRevisionId: REVISION_ID,
                },
            ],
            scopes: [
                { planId: TRACK_ID, skillId: SKILL_ID, targetBand: null, sortOrder: 1 },
                { planId: TRACK_ID, skillId: GAP_SKILL_ID, targetBand: null, sortOrder: 2 },
                { planId: EXAM_ID, skillId: SKILL_ID, targetBand: null, sortOrder: 1 },
                { planId: EXAM_ID, skillId: GAP_SKILL_ID, targetBand: null, sortOrder: 2 },
            ],
            planMaterials: [{ planId: TRACK_ID, bookId: BOOK_ID }],
            studentOverrides: [],
            tags: [
                { problemId: 'p1', skillId: SKILL_ID, challengeBand: 2, equivalenceKey: 'eq-1' },
                { problemId: 'p2', skillId: SKILL_ID, challengeBand: 2, equivalenceKey: 'eq-2' },
                { problemId: 'p3', skillId: SKILL_ID, challengeBand: 2, equivalenceKey: 'eq-3' },
                { problemId: 'p4', skillId: GAP_SKILL_ID, challengeBand: null, equivalenceKey: null },
            ],
            attempts: [
                {
                    id: 'a1', sessionId: 's1', studentId: STUDENT_ID, problemId: 'p1', subLabel: null,
                    correct: false, unsure: false, responseState: 'answered', evidenceKind: 'independent_new',
                    analysisEligible: true, submittedAt: '2026-07-08T15:30:00.000Z', skillId: SKILL_ID,
                    challengeBand: 2, equivalenceKey: 'eq-1',
                },
                {
                    id: 'a2', sessionId: 's2', studentId: STUDENT_ID, problemId: 'p2', subLabel: null,
                    correct: false, unsure: false, responseState: 'answered', evidenceKind: 'independent_new',
                    analysisEligible: true, submittedAt: '2026-07-09T15:30:00.000Z', skillId: SKILL_ID,
                    challengeBand: 2, equivalenceKey: 'eq-2',
                },
                {
                    id: 'a3', sessionId: 's3', studentId: STUDENT_ID, problemId: 'p3', subLabel: null,
                    correct: false, unsure: false, responseState: 'blank', evidenceKind: 'independent_new',
                    analysisEligible: false, submittedAt: '2026-07-10T15:30:00.000Z', skillId: SKILL_ID,
                    challengeBand: 2, equivalenceKey: 'eq-3',
                },
            ],
            problems: [
                { id: 'p1', bookId: BOOK_ID, pagePrinted: 10, number: '1', expectedPartCount: 1 },
                { id: 'p2', bookId: BOOK_ID, pagePrinted: 11, number: '2', expectedPartCount: 1 },
                { id: 'p3', bookId: BOOK_ID, pagePrinted: 12, number: '3', expectedPartCount: 1 },
            ],
        };

        const data = buildLearningAnalysisData(snapshot);

        expect(data.actionQueue).toHaveLength(1);
        expect(data.actionQueue[0]).toMatchObject({
            studentId: STUDENT_ID,
            skillId: SKILL_ID,
            status: 'support_candidate',
            relatedPlanNames: ['2학기 중간고사', '현행 학습'],
        });
        expect(data.actionQueue[0].evidence.filter((event) => event.outcome === 'blank')).toHaveLength(1);
        expect(data.actionQueue[0].evidence.find((event) => event.outcome === 'blank')?.included).toBe(false);
        expect(data.tracks[0]).toMatchObject({ dueStudentCount: 1, actionCount: 1, materialCount: 1 });
        expect(data.examPlans[0].summary).toEqual({
            scope: 2,
            analyzable: 1,
            recentlyConfirmed: 0,
            needsCheck: 0,
            supportCandidate: 1,
            contentGap: 1,
        });
        expect(data.examStudents[0].summary).toMatchObject({
            analyzable: 1,
            supportCandidate: 1,
            contentGap: 1,
        });
        expect(data.examStudents[0].status).toBe('support_candidate');

        const assignedData = buildLearningAnalysisData({
            ...snapshot,
            assignedActions: [{
                actionId: `${STUDENT_ID}::${SKILL_ID}`,
                assignedAt: '2026-07-10T00:00:00.000Z',
            }],
        });
        expect(assignedData.actionQueue).toHaveLength(0);
        expect(assignedData.tracks[0]).toMatchObject({ dueStudentCount: 0, actionCount: 0 });
        expect(buildLearningAnalysisData({
            ...snapshot,
            assignedActions: [{
                actionId: `${STUDENT_ID}::${SKILL_ID}`,
                assignedAt: '2026-07-09T00:00:00.000Z',
            }],
        }).actionQueue).toHaveLength(1);
    });

    it('does not confirm a two-part problem when only one part was recorded', () => {
        const snapshot: LearningAnalysisSnapshot = {
            asOfDate: '2026-07-11',
            selectedExamPlanId: EXAM_ID,
            classrooms: [{ id: CLASS_ID, name: '중2 A반' }],
            students: [{ id: STUDENT_ID, name: '김학생', classIds: [CLASS_ID] }],
            skills: [{ id: SKILL_ID, name: '삼각형의 성질', unitLabel: '중2', sortOrder: 1 }],
            catalogSkillIds: [SKILL_ID],
            materials: [],
            plans: [{
                id: EXAM_ID,
                classroomId: CLASS_ID,
                name: '시험',
                planType: 'exam',
                trackKind: null,
                targetBand: 2,
                maintenanceIntervalDays: null,
                examDate: '2026-08-01',
                recheckIntervalDays: 21,
                taxonomyRevisionId: REVISION_ID,
            }],
            scopes: [{ planId: EXAM_ID, skillId: SKILL_ID, targetBand: null, sortOrder: 1 }],
            planMaterials: [],
            studentOverrides: [],
            tags: [
                { problemId: 'multi-1', skillId: SKILL_ID, challengeBand: 2, equivalenceKey: 'multi-eq-1' },
                { problemId: 'multi-2', skillId: SKILL_ID, challengeBand: 2, equivalenceKey: 'multi-eq-2' },
            ],
            attempts: [
                {
                    id: 'part-a', sessionId: 'multi-session-1', studentId: STUDENT_ID,
                    problemId: 'multi-1', subLabel: '(1)', correct: true, unsure: false,
                    responseState: 'answered', evidenceKind: 'independent_new', analysisEligible: true,
                    submittedAt: '2026-07-09T01:00:00.000Z', skillId: SKILL_ID,
                    challengeBand: 2, equivalenceKey: 'multi-eq-1',
                },
                {
                    id: 'part-b', sessionId: 'multi-session-2', studentId: STUDENT_ID,
                    problemId: 'multi-2', subLabel: '(1)', correct: true, unsure: false,
                    responseState: 'answered', evidenceKind: 'independent_new', analysisEligible: true,
                    submittedAt: '2026-07-10T01:00:00.000Z', skillId: SKILL_ID,
                    challengeBand: 2, equivalenceKey: 'multi-eq-2',
                },
            ],
            problems: [
                { id: 'multi-1', bookId: null, pagePrinted: 1, number: '1', expectedPartCount: 2 },
                { id: 'multi-2', bookId: null, pagePrinted: 2, number: '2', expectedPartCount: 2 },
            ],
        };

        const data = buildLearningAnalysisData(snapshot);
        expect(data.examStudents[0].status).toBe('needs_check');
        expect(data.examStudents[0].summary.recentlyConfirmed).toBe(0);
        expect(data.examStudents[0].evidence.every((event) => event.outcome === 'partial')).toBe(true);
    });
});
