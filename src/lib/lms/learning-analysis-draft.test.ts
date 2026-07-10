import { describe, expect, it } from 'vitest';
import {
    buildLearningAnalysisAssignmentDraft,
    clearLearningAnalysisAssignmentDraft,
    readLearningAnalysisAssignmentDraft,
    saveLearningAnalysisAssignmentDraft,
} from './learning-analysis-draft';

class MemoryStorage {
    private readonly values = new Map<string, string>();

    getItem(key: string) {
        return this.values.get(key) ?? null;
    }

    setItem(key: string, value: string) {
        this.values.set(key, value);
    }

    removeItem(key: string) {
        this.values.delete(key);
    }
}

describe('learning analysis assignment draft', () => {
    it('deduplicates students while retaining the selected skills', () => {
        const draft = buildLearningAnalysisAssignmentDraft([
            { id: 'student-1::skill-1', studentId: 'student-1', skillId: 'skill-1', skillName: '일차함수' },
            { id: 'student-1::skill-2', studentId: 'student-1', skillId: 'skill-2', skillName: '삼각형' },
            { id: 'student-2::skill-1', studentId: 'student-2', skillId: 'skill-1', skillName: '일차함수' },
            { id: 'student-2::skill-2', studentId: 'student-2', skillId: 'skill-2', skillName: '삼각형' },
        ], new Date('2026-07-11T00:00:00.000Z'));

        expect(draft).toMatchObject({
            title: '학습 분석 확인 과제 (2개 유형)',
            studentIds: ['student-1', 'student-2'],
            skillNames: ['일차함수', '삼각형'],
        });
        expect(draft.actionIds).toHaveLength(4);
        expect(draft.actions).toHaveLength(4);
    });

    it('round-trips through storage and expires stale drafts', () => {
        const storage = new MemoryStorage();
        const draft = buildLearningAnalysisAssignmentDraft([
            { id: 'student-1::skill-1', studentId: 'student-1', skillId: 'skill-1', skillName: '확률' },
        ], new Date('2026-07-11T00:00:00.000Z'));

        saveLearningAnalysisAssignmentDraft(storage, draft);
        expect(
            readLearningAnalysisAssignmentDraft(storage, new Date('2026-07-11T01:00:00.000Z')),
        ).toEqual(draft);
        expect(
            readLearningAnalysisAssignmentDraft(storage, new Date('2026-07-12T01:00:01.000Z')),
        ).toBeNull();

        saveLearningAnalysisAssignmentDraft(storage, draft);
        clearLearningAnalysisAssignmentDraft(storage);
        expect(readLearningAnalysisAssignmentDraft(storage)).toBeNull();
    });

    it('rejects an empty selection', () => {
        expect(() => buildLearningAnalysisAssignmentDraft([])).toThrow('조치 항목이 없습니다');
    });

    it('rejects a draft that would broaden different student skill needs', () => {
        expect(() => buildLearningAnalysisAssignmentDraft([
            { id: 'student-1::skill-1', studentId: 'student-1', skillId: 'skill-1', skillName: '일차함수' },
            { id: 'student-2::skill-2', studentId: 'student-2', skillId: 'skill-2', skillName: '삼각형' },
        ])).toThrow('같은 유형 조합의 학생끼리');
    });
});
