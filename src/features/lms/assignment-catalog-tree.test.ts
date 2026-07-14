import { describe, expect, it } from 'vitest';
import type { AssignmentBookCatalogSummary } from './types';
import {
    buildAssignmentCatalogTree,
    buildCourseLabels,
    buildMajorOptions,
    buildMiddleOptions,
    buildTypeSections,
} from './assignment-catalog-tree';

function book(overrides: Partial<AssignmentBookCatalogSummary>): AssignmentBookCatalogSummary {
    return {
        id: 'book-1',
        bookKey: 'gaeppul_math1_1_power',
        title: '개념플러스유형 중학수학 1-1 파워',
        subject: 'math',
        grade: '중1',
        units: [],
        problemTypes: [],
        ...overrides,
    };
}

describe('assignment catalog folder tree', () => {
    it('개플유 중등 단원명을 대단원과 중단원으로 나눈다', () => {
        const tree = buildAssignmentCatalogTree([book({
            units: [{ id: 'unit-1', name: '1. 소인수분해 / 01 소인수분해', partName: '유형편(파워)', problemCount: 8 }],
            problemTypes: [{ id: 'type-1', unitId: 'unit-1', name: '유형1: 소수와 합성수', problemCount: 3 }],
        })]);

        const grade = tree.find((source) => source.key === 'gaeppul')!.grades.find((row) => row.label === '중1')!;
        expect(grade.courses[0].label).toBe('1학기');
        expect(grade.courses[0].majors[0].label).toBe('1. 소인수분해');
        expect(grade.courses[0].majors[0].middles[0].label).toBe('01 소인수분해');
        expect(grade.courses[0].majors[0].middles[0].leaves[0].label).toBe('유형1: 소수와 합성수');
        expect(grade.courses[0].majors[0].middles[0].leaves[0].material).toBe('type');
    });

    it('개플유 중등 2학기 책을 2학기 폴더로 묶는다', () => {
        const tree = buildAssignmentCatalogTree([book({
            bookKey: 'gaeppul_math1_2_power',
            title: '개념플러스유형 중학수학 1-2 파워',
            units: [{ id: 'unit-1', name: '4. 기본 도형 / 01 점, 선, 면', partName: '유형편(파워)', problemCount: 8 }],
            problemTypes: [{ id: 'type-1', unitId: 'unit-1', name: '유형1: 점, 선, 면', problemCount: 3 }],
        })]);

        const grade = tree.find((source) => source.key === 'gaeppul')!.grades.find((row) => row.label === '중1')!;
        expect(grade.courses.map((course) => course.label)).toEqual(['2학기']);
    });

    it('개플유 고등 유형편의 순서를 교육과정 대단원으로 묶는다', () => {
        const units = [
            '01 다항식의 연산',
            '01 나머지 정리',
            '02 인수분해',
            '01 복소수의 뜻과 사칙연산',
        ].map((name, index) => ({ id: `unit-${index}`, name: `${name} / ${name}`, partName: '유형편', problemCount: 1 }));
        const tree = buildAssignmentCatalogTree([book({
            id: 'high-book',
            bookKey: 'gaeppul_high_common1_type',
            title: '개념플러스유형 공통수학1 유형편',
            grade: '고1',
            units,
            problemTypes: units.map((unit, index) => ({ id: `type-${index}`, unitId: unit.id, name: `유형${index + 1}`, problemCount: 1 })),
        })]);

        const course = tree.find((source) => source.key === 'gaeppul')!.grades.find((row) => row.label === '고1')!.courses[0];
        expect(course.label).toBe('공통수학1');
        const majors = course.majors;
        expect(majors.map((major) => major.label)).toEqual(['Ⅰ. 다항식', 'Ⅱ. 방정식과 부등식']);
        expect(majors[1].middles[0].label).toBe('01 복소수의 뜻과 사칙연산');
    });

    it('문제 은행의 과정명으로 학년을 구분하고 없는 중단원은 전체 유형으로 표시한다', () => {
        const tree = buildAssignmentCatalogTree([book({
            id: 'bank-book',
            bookKey: 'nextum_math_bank',
            title: '넥섬 수학 문제은행',
            grade: '중2·중3·고등',
            units: [{ id: 'bank-unit', name: '방정식과 부등식', partName: '공통수학1', problemCount: 10 }],
            problemTypes: [{ id: 'bank-type', unitId: 'bank-unit', name: '이차방정식의 판별식', problemCount: 10 }],
        })]);

        const grade = tree.find((source) => source.key === 'bank')!.grades.find((row) => row.label === '고1')!;
        expect(grade.courses[0].label).toBe('공통수학1');
        expect(grade.courses[0].majors[0].label).toBe('방정식과 부등식');
        expect(grade.courses[0].majors[0].middles[0].label).toBe('전체 유형');
        expect(grade.courses[0].majors[0].middles[0].leaves[0].partLabel).toBe('문제은행');
        expect(grade.courses[0].majors[0].middles[0].leaves[0].material).toBe('bank');
    });

    it('개념 교재를 개념편 자료로 구분한다', () => {
        const tree = buildAssignmentCatalogTree([book({
            bookKey: 'gaeppul_math2_1_concept',
            title: '개념플러스유형 중학수학 2-1 개념편',
            grade: '중2',
            units: [{ id: 'concept-unit', name: '1. 유리수와 순환소수', partName: '개념편', problemCount: 4 }],
            problemTypes: [{ id: 'concept-type', unitId: 'concept-unit', name: '개념 확인', problemCount: 4 }],
        })]);

        const leaf = tree[0].grades.find((row) => row.label === '중2')!.courses[0].majors[0].middles[0].leaves[0];
        expect(leaf.courseLabel).toBe('1학기');
        expect(leaf.material).toBe('concept');
        expect(leaf.problemCount).toBe(4);
    });

    it('빈 학년도 폴더 구조에 유지한다', () => {
        const tree = buildAssignmentCatalogTree([]);
        expect(tree).toHaveLength(2);
        expect(tree.every((source) => source.grades.map((grade) => grade.label).join(',') === '중1,중2,중3,고1,고2,고3')).toBe(true);
    });

    it('선택한 학년에 실제로 연결된 학기와 과목만 표시한다', () => {
        const tree = buildAssignmentCatalogTree([
            book({
                id: 'common1-book',
                bookKey: 'gaeppul_high_common1_type',
                title: '개념플러스유형 공통수학1 유형편',
                grade: '고1',
                units: [{ id: 'common1-unit', name: '01 다항식 / 01 다항식', partName: '유형편', problemCount: 1 }],
                problemTypes: [{ id: 'common1-type', unitId: 'common1-unit', name: '다항식', problemCount: 1 }],
            }),
            book({
                id: 'algebra-book',
                bookKey: 'gaeppul_high_algebra_type',
                title: '개념플러스유형 대수 유형편',
                grade: '고2',
                units: [{ id: 'algebra-unit', name: '01 지수 / 01 지수', partName: '유형편', problemCount: 1 }],
                problemTypes: [{ id: 'algebra-type', unitId: 'algebra-unit', name: '지수', problemCount: 1 }],
            }),
        ]);
        const leaves = tree.flatMap((source) => source.grades.flatMap((grade) => grade.courses.flatMap((course) => (
            course.majors.flatMap((major) => major.middles.flatMap((middle) => middle.leaves))
        ))));

        expect(buildCourseLabels(leaves, new Set(['고1']))).toEqual(['공통수학1']);
        expect(buildCourseLabels(leaves, new Set(['고2']))).toEqual(['대수']);
        expect(buildCourseLabels(leaves, new Set(['고1', '고2']))).toEqual(['공통수학1', '대수']);
    });

    it('복수 학년과 자료를 선택해도 단원 문맥과 유형 구분자를 유지한다', () => {
        const tree = buildAssignmentCatalogTree([
            book({
                id: 'middle1-type',
                bookKey: 'gaeppul_math1_1_power',
                units: [{ id: 'm1-type-unit', name: '1. 소인수분해 / 01 소인수분해', partName: '유형편(파워)', problemCount: 2 }],
                problemTypes: [{ id: 'm1-type', unitId: 'm1-type-unit', name: '소수와 합성수', problemCount: 2 }],
            }),
            book({
                id: 'middle1-concept',
                bookKey: 'gaeppul_math1_1_concept',
                units: [{ id: 'm1-concept-unit', name: '1. 소인수분해 / 01 소인수분해', partName: '개념편', problemCount: 1 }],
                problemTypes: [{ id: 'm1-concept', unitId: 'm1-concept-unit', name: '개념 확인', problemCount: 1 }],
            }),
            book({
                id: 'middle2-type',
                bookKey: 'gaeppul_math2_1_power',
                title: '개념플러스유형 중학수학 2-1 파워',
                grade: '중2',
                units: [{ id: 'm2-type-unit', name: '1. 유리수와 순환소수 / 01 유리수와 순환소수', partName: '유형편(파워)', problemCount: 1 }],
                problemTypes: [{ id: 'm2-type', unitId: 'm2-type-unit', name: '유한소수', problemCount: 1 }],
            }),
        ]);
        const leaves = tree.flatMap((source) => source.grades.flatMap((grade) => grade.courses.flatMap((course) => (
            course.majors.flatMap((major) => major.middles.flatMap((middle) => middle.leaves))
        ))));

        const majors = buildMajorOptions(leaves);
        const middles = buildMiddleOptions(majors, new Set(majors.map((major) => major.key)));
        const sections = buildTypeSections(middles, new Set(middles.map((middle) => middle.key)), '');

        expect(majors).toHaveLength(2);
        expect(middles).toHaveLength(2);
        expect(sections.map((section) => section.contextLabel)).toEqual([
            '중1 · 1학기 · 개념편',
            '중1 · 1학기 · 유형편',
            '중2 · 1학기 · 유형편',
        ]);
    });
});
