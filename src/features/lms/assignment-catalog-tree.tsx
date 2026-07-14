'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
    BookOpen,
    CheckCircle2,
    Database,
    Folder,
    Search,
    Tags,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { AssignmentBookCatalogSummary } from './types';

const GRADE_ORDER = ['중1', '중2', '중3', '고1', '고2', '고3'] as const;

export type CatalogGrade = typeof GRADE_ORDER[number];
type CatalogSource = 'gaeppul' | 'bank';
export type AssignmentCatalogMaterial = 'concept' | 'type' | 'bank';

export interface AssignmentCatalogLeaf {
    key: string;
    label: string;
    source: CatalogSource;
    grade: CatalogGrade;
    courseLabel: string;
    material: AssignmentCatalogMaterial;
    majorLabel: string;
    middleLabel: string;
    bookId: string;
    bookTitle: string;
    bookKey: string;
    unitId: string;
    typeId: string | null;
    partLabel: string;
    problemCount: number;
}

export interface AssignmentCatalogMiddleNode {
    key: string;
    label: string;
    leaves: AssignmentCatalogLeaf[];
}

export interface AssignmentCatalogMajorNode {
    key: string;
    label: string;
    middles: AssignmentCatalogMiddleNode[];
}

export interface AssignmentCatalogCourseNode {
    key: string;
    label: string;
    majors: AssignmentCatalogMajorNode[];
}

export interface AssignmentCatalogGradeNode {
    key: string;
    label: CatalogGrade;
    courses: AssignmentCatalogCourseNode[];
}

export interface AssignmentCatalogSourceNode {
    key: CatalogSource;
    label: string;
    grades: AssignmentCatalogGradeNode[];
}

type HighCourseKey = 'common1' | 'common2' | 'algebra' | 'geometry' | 'calculus1' | 'calculus2' | 'probability';

const HIGH_MAJOR_RANGES: Record<HighCourseKey, Array<{ end: number; label: string }>> = {
    common1: [
        { end: 2, label: 'Ⅰ. 다항식' },
        { end: 12, label: 'Ⅱ. 방정식과 부등식' },
        { end: 15, label: 'Ⅲ. 경우의 수' },
        { end: 17, label: 'Ⅳ. 행렬' },
    ],
    common2: [
        { end: 7, label: 'Ⅰ. 도형의 방정식' },
        { end: 12, label: 'Ⅱ. 집합과 명제' },
        { end: 15, label: 'Ⅲ. 함수' },
        { end: 17, label: 'Ⅳ. 유리함수와 무리함수' },
    ],
    algebra: [
        { end: 6, label: 'Ⅰ. 지수함수와 로그함수' },
        { end: 10, label: 'Ⅱ. 삼각함수' },
        { end: 14, label: 'Ⅲ. 수열' },
    ],
    geometry: [
        { end: 3, label: 'Ⅰ. 이차곡선' },
        { end: 7, label: 'Ⅱ. 공간도형과 공간좌표' },
        { end: 12, label: 'Ⅲ. 벡터' },
    ],
    calculus1: [
        { end: 2, label: 'Ⅰ. 함수의 극한과 연속' },
        { end: 9, label: 'Ⅱ. 미분' },
        { end: 13, label: 'Ⅲ. 적분' },
    ],
    calculus2: [
        { end: 3, label: 'Ⅰ. 수열의 극한' },
        { end: 12, label: 'Ⅱ. 미분법' },
        { end: 16, label: 'Ⅲ. 적분법' },
    ],
    probability: [
        { end: 1, label: 'Ⅰ. 경우의 수' },
        { end: 3, label: 'Ⅱ. 확률' },
        { end: 6, label: 'Ⅲ. 통계' },
    ],
};

const HIGH_COURSE_LABELS: Record<HighCourseKey, string> = {
    common1: '공통수학1',
    common2: '공통수학2',
    algebra: '대수',
    geometry: '기하',
    calculus1: '미적분Ⅰ',
    calculus2: '미적분Ⅱ',
    probability: '확률과 통계',
};

const COURSE_ORDER = [
    '1학기',
    '2학기',
    '공통수학1',
    '공통수학2',
    '대수',
    '기하',
    '미적분Ⅰ',
    '미적분Ⅱ',
    '확률과 통계',
    '기타',
];

const MATERIAL_OPTIONS: Array<{ key: AssignmentCatalogMaterial; label: string }> = [
    { key: 'concept', label: '개념편' },
    { key: 'type', label: '유형편' },
    { key: 'bank', label: '문제은행' },
];

type MiddleMap = Map<string, AssignmentCatalogLeaf[]>;
type MajorMap = Map<string, MiddleMap>;
type CourseMap = Map<string, MajorMap>;

function sourceOf(book: AssignmentBookCatalogSummary): CatalogSource {
    return book.bookKey === 'nextum_math_bank' ? 'bank' : 'gaeppul';
}

function materialOf(book: AssignmentBookCatalogSummary, partName: string | null): AssignmentCatalogMaterial {
    if (sourceOf(book) === 'bank') return 'bank';
    const bookKey = book.bookKey.toLowerCase();
    const part = (partName || '').replace(/\s+/gu, '');
    return bookKey.includes('concept') || part.includes('개념편') || part === '개념' ? 'concept' : 'type';
}

function highCourseOf(bookKey: string): HighCourseKey | null {
    if (bookKey.includes('_common1_')) return 'common1';
    if (bookKey.includes('_common2_')) return 'common2';
    if (bookKey.includes('_algebra_')) return 'algebra';
    if (bookKey.includes('_geometry_')) return 'geometry';
    if (bookKey.includes('_calculus1_')) return 'calculus1';
    if (bookKey.includes('_calculus2_')) return 'calculus2';
    if (bookKey.includes('_probability_')) return 'probability';
    return null;
}

function courseLabelOf(
    book: AssignmentBookCatalogSummary,
    grade: CatalogGrade,
    unitName: string,
    partName: string | null,
): string {
    if (grade.startsWith('중')) {
        const semesterFromBookKey = book.bookKey.match(/_math[123]_([12])(?:_|$)/u)?.[1];
        if (semesterFromBookKey) return `${semesterFromBookKey}학기`;

        const value = `${partName || ''} ${unitName}`.replace(/\s+/gu, '');
        if (value.includes('1학기')) return '1학기';
        if (value.includes('2학기')) return '2학기';

        const secondSemesterKeywords = [
            '기본도형',
            '평면도형',
            '입체도형',
            '자료의정리',
            '도형의성질',
            '도형의닮음',
            '피타고라스',
            '확률',
            '삼각비',
            '원의성질',
            '통계',
        ];
        return secondSemesterKeywords.some((keyword) => value.includes(keyword)) ? '2학기' : '1학기';
    }

    const courseFromBookKey = highCourseOf(book.bookKey);
    if (courseFromBookKey) return HIGH_COURSE_LABELS[courseFromBookKey];

    const value = `${partName || ''} ${book.title} ${unitName}`.replace(/\s+/gu, '').toLowerCase();
    if (value.includes('공통수학1')) return '공통수학1';
    if (value.includes('공통수학2')) return '공통수학2';
    if (value.includes('확률과통계')) return '확률과 통계';
    if (value.includes('미적분ⅱ') || value.includes('미적분ii') || value.includes('미적분2')) return '미적분Ⅱ';
    if (value.includes('미적분ⅰ') || value.includes('미적분i') || value.includes('미적분1')) return '미적분Ⅰ';
    if (value.includes('기하')) return '기하';
    if (value.includes('대수')) return '대수';
    return '기타';
}

function gradeOf(book: AssignmentBookCatalogSummary, partName: string | null): CatalogGrade {
    if (GRADE_ORDER.includes(book.grade as CatalogGrade)) return book.grade as CatalogGrade;
    const value = `${partName || ''} ${book.title}`.replace(/\s+/gu, '').toLowerCase();
    if (value.includes('중1')) return '중1';
    if (value.includes('중2')) return '중2';
    if (value.includes('중3')) return '중3';
    if (value.includes('공통수학1') || value.includes('공통수학2')) return '고1';
    if (value.includes('고3')) return '고3';
    return '고2';
}

function cleanUnitLabel(value: string): string {
    return value.replace(/\s+/gu, ' ').trim();
}

function splitUnitName(name: string): { major: string; middle: string } {
    const [major, middle] = name.split(/\s+\/\s+/u).map(cleanUnitLabel);
    return { major: major || name, middle: middle || major || name };
}

function partLabelOf(book: AssignmentBookCatalogSummary, partName: string | null): string {
    if (sourceOf(book) === 'bank') return '문제은행';
    if (book.bookKey.endsWith('_concept')) return '개념';
    if (book.bookKey.endsWith('_light')) return '라이트';
    if (book.bookKey.endsWith('_power')) return '파워';
    if (book.bookKey.endsWith('_type')) return '유형편';
    return partName || '개플유';
}

function romanMajorLabel(course: HighCourseKey, middleLabel: string): string | null {
    const roman = middleLabel.match(/^([ⅠⅡⅢⅣ])-\d+/u)?.[1];
    if (!roman) return null;
    const romanIndex = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ'].indexOf(roman);
    const ranges = HIGH_MAJOR_RANGES[course];
    return ranges[romanIndex]?.label || null;
}

function majorAndMiddleOf(
    book: AssignmentBookCatalogSummary,
    unitIndex: number,
    unitName: string,
    partName: string | null,
): { major: string; middle: string } {
    const split = splitUnitName(unitName);
    const source = sourceOf(book);
    if (source === 'bank') {
        return { major: split.major, middle: split.middle === split.major ? '전체 유형' : split.middle };
    }

    const course = highCourseOf(book.bookKey);
    if (course) {
        const conceptMajor = romanMajorLabel(course, split.middle);
        if (conceptMajor) return { major: conceptMajor, middle: split.middle };
        const range = HIGH_MAJOR_RANGES[course].find((candidate) => unitIndex <= candidate.end);
        return { major: range?.label || book.title, middle: split.middle };
    }

    if (split.major !== split.middle) return split;
    return {
        major: split.major,
        middle: partLabelOf(book, partName),
    };
}

function ensureMapValue<K, V>(map: Map<K, V>, key: K, create: () => V): V {
    const current = map.get(key);
    if (current) return current;
    const next = create();
    map.set(key, next);
    return next;
}

export function buildAssignmentCatalogTree(books: AssignmentBookCatalogSummary[]): AssignmentCatalogSourceNode[] {
    const sources = new Map<CatalogSource, Map<CatalogGrade, CourseMap>>();
    for (const source of ['gaeppul', 'bank'] as const) {
        const grades = new Map<CatalogGrade, CourseMap>();
        GRADE_ORDER.forEach((grade) => grades.set(grade, new Map()));
        sources.set(source, grades);
    }

    for (const book of books) {
        const source = sourceOf(book);
        const typesByUnit = new Map<string, typeof book.problemTypes>();
        for (const type of book.problemTypes) {
            if (!type.unitId) continue;
            const rows = typesByUnit.get(type.unitId) || [];
            rows.push(type);
            typesByUnit.set(type.unitId, rows);
        }

        book.units.forEach((unit, unitIndex) => {
            const grade = gradeOf(book, unit.partName);
            const course = courseLabelOf(book, grade, unit.name, unit.partName);
            const { major, middle } = majorAndMiddleOf(book, unitIndex, unit.name, unit.partName);
            const courses = sources.get(source)!.get(grade)!;
            const majors = ensureMapValue(courses, course, () => new Map<string, MiddleMap>());
            const middles = ensureMapValue(majors, major, () => new Map<string, AssignmentCatalogLeaf[]>());
            const leaves = ensureMapValue(middles, middle, () => [] as AssignmentCatalogLeaf[]);
            const types = typesByUnit.get(unit.id) || [];
            if (types.length === 0) {
                leaves.push({
                    key: `${book.id}:${unit.id}:all`,
                    label: '전체 문제',
                    source,
                    grade,
                    courseLabel: course,
                    material: materialOf(book, unit.partName),
                    majorLabel: major,
                    middleLabel: middle,
                    bookId: book.id,
                    bookTitle: book.title,
                    bookKey: book.bookKey,
                    unitId: unit.id,
                    typeId: null,
                    partLabel: partLabelOf(book, unit.partName),
                    problemCount: unit.problemCount,
                });
                return;
            }
            for (const type of types) {
                leaves.push({
                    key: `${book.id}:${unit.id}:${type.id}`,
                    label: type.name,
                    source,
                    grade,
                    courseLabel: course,
                    material: materialOf(book, unit.partName),
                    majorLabel: major,
                    middleLabel: middle,
                    bookId: book.id,
                    bookTitle: book.title,
                    bookKey: book.bookKey,
                    unitId: unit.id,
                    typeId: type.id,
                    partLabel: partLabelOf(book, unit.partName),
                    problemCount: type.problemCount,
                });
            }
        });
    }

    return (['gaeppul', 'bank'] as const).map((source) => ({
        key: source,
        label: source === 'gaeppul' ? '개플유' : '문제 은행',
        grades: GRADE_ORDER.map((grade) => ({
            key: `${source}:${grade}`,
            label: grade,
            courses: [...sources.get(source)!.get(grade)!.entries()]
                .sort(([left], [right]) => COURSE_ORDER.indexOf(left) - COURSE_ORDER.indexOf(right))
                .map(([course, majors]) => ({
                    key: `${source}:${grade}:${course}`,
                    label: course,
                    majors: [...majors.entries()].map(([major, middles]) => ({
                        key: `${source}:${grade}:${course}:${major}`,
                        label: major,
                        middles: [...middles.entries()].map(([middle, leaves]) => ({
                            key: `${source}:${grade}:${course}:${major}:${middle}`,
                            label: middle,
                            leaves,
                        })),
                    })),
                })),
        })),
    }));
}

function flattenCatalogTree(tree: AssignmentCatalogSourceNode[]): AssignmentCatalogLeaf[] {
    return tree.flatMap((source) => source.grades.flatMap((grade) => grade.courses.flatMap((course) => (
        course.majors.flatMap((major) => major.middles.flatMap((middle) => middle.leaves))
    ))));
}

export function groupAssignmentCatalogLeaves(leaves: AssignmentCatalogLeaf[]): AssignmentCatalogMajorNode[] {
    const majors = new Map<string, Map<string, AssignmentCatalogLeaf[]>>();
    for (const leaf of leaves) {
        const middles = ensureMapValue(majors, leaf.majorLabel, () => new Map<string, AssignmentCatalogLeaf[]>());
        const rows = ensureMapValue(middles, leaf.middleLabel, () => [] as AssignmentCatalogLeaf[]);
        rows.push(leaf);
    }
    return [...majors.entries()].map(([major, middles]) => ({
        key: `detail:${major}`,
        label: major,
        middles: [...middles.entries()].map(([middle, rows]) => ({
            key: `detail:${major}:${middle}`,
            label: middle,
            leaves: rows,
        })),
    }));
}

function SelectorColumn({
    step,
    title,
    children,
    className,
}: {
    step: number;
    title: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <section className={cn('min-w-0 border-r border-border p-2', className)}>
            <div className="mb-1.5 flex items-center gap-1.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {step}
                </span>
                <span className="truncate text-xs font-bold text-foreground">{title}</span>
            </div>
            {children}
        </section>
    );
}

interface CatalogMajorOption {
    key: string;
    grade: CatalogGrade;
    courseLabel: string;
    label: string;
    leaves: AssignmentCatalogLeaf[];
}

interface CatalogMiddleOption {
    key: string;
    majorKey: string;
    grade: CatalogGrade;
    courseLabel: string;
    majorLabel: string;
    label: string;
    leaves: AssignmentCatalogLeaf[];
}

interface CatalogTypeSection {
    key: string;
    contextLabel: string;
    pathLabel: string;
    leaves: AssignmentCatalogLeaf[];
}

function materialLabel(material: AssignmentCatalogMaterial): string {
    return MATERIAL_OPTIONS.find((row) => row.key === material)?.label || material;
}

export function buildMajorOptions(leaves: AssignmentCatalogLeaf[]): CatalogMajorOption[] {
    const options = new Map<string, CatalogMajorOption>();
    for (const leaf of leaves) {
        const key = `${leaf.grade}\u0000${leaf.courseLabel}\u0000${leaf.majorLabel}`;
        const option = options.get(key) || {
            key,
            grade: leaf.grade,
            courseLabel: leaf.courseLabel,
            label: leaf.majorLabel,
            leaves: [],
        };
        option.leaves.push(leaf);
        options.set(key, option);
    }
    return [...options.values()];
}

export function buildCourseLabels(
    leaves: AssignmentCatalogLeaf[],
    selectedGrades: Set<CatalogGrade>,
): string[] {
    const labels = new Set(leaves
        .filter((leaf) => selectedGrades.has(leaf.grade))
        .map((leaf) => leaf.courseLabel));

    return [...labels].sort((left, right) => {
        const leftIndex = COURSE_ORDER.indexOf(left);
        const rightIndex = COURSE_ORDER.indexOf(right);
        if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right, 'ko');
        if (leftIndex === -1) return 1;
        if (rightIndex === -1) return -1;
        return leftIndex - rightIndex;
    });
}

export function buildMiddleOptions(majors: CatalogMajorOption[], selectedMajorKeys: Set<string>): CatalogMiddleOption[] {
    const options: CatalogMiddleOption[] = [];
    for (const major of majors) {
        if (!selectedMajorKeys.has(major.key)) continue;
        const leavesByMiddle = new Map<string, AssignmentCatalogLeaf[]>();
        for (const leaf of major.leaves) {
            const rows = leavesByMiddle.get(leaf.middleLabel) || [];
            rows.push(leaf);
            leavesByMiddle.set(leaf.middleLabel, rows);
        }
        for (const [middleLabel, leaves] of leavesByMiddle) {
            options.push({
                key: `${major.key}\u0000${middleLabel}`,
                majorKey: major.key,
                grade: major.grade,
                courseLabel: major.courseLabel,
                majorLabel: major.label,
                label: middleLabel,
                leaves,
            });
        }
    }
    return options;
}

export function buildTypeSections(
    middles: CatalogMiddleOption[],
    selectedMiddleKeys: Set<string>,
    query: string,
): CatalogTypeSection[] {
    const normalizedQuery = query.trim().toLowerCase();
    const sections: CatalogTypeSection[] = [];
    for (const middle of middles) {
        if (!selectedMiddleKeys.has(middle.key)) continue;
        const leavesByMaterial = new Map<AssignmentCatalogMaterial, AssignmentCatalogLeaf[]>();
        for (const leaf of middle.leaves) {
            if (normalizedQuery && !`${leaf.label} ${leaf.partLabel} ${leaf.bookTitle}`.toLowerCase().includes(normalizedQuery)) continue;
            const rows = leavesByMaterial.get(leaf.material) || [];
            rows.push(leaf);
            leavesByMaterial.set(leaf.material, rows);
        }
        for (const { key: material } of MATERIAL_OPTIONS) {
            const leaves = leavesByMaterial.get(material) || [];
            if (leaves.length === 0) continue;
            sections.push({
                key: `${middle.key}\u0000${material}`,
                contextLabel: `${middle.grade} · ${middle.courseLabel} · ${materialLabel(material)}`,
                pathLabel: `${middle.majorLabel} › ${middle.label}`,
                leaves,
            });
        }
    }
    return sections;
}

export function AssignmentCatalogTree({
    books,
    selectedBookId,
    selectedUnitIds,
    selectedTypeIds,
    onSelectLeaf,
    onRemoveMiddle,
}: {
    books: AssignmentBookCatalogSummary[];
    selectedBookId: string;
    selectedUnitIds: Set<string>;
    selectedTypeIds: Set<string>;
    onSelectLeaf: (leaf: AssignmentCatalogLeaf) => void;
    onRemoveMiddle: (leaves: AssignmentCatalogLeaf[]) => void;
}) {
    const tree = useMemo(() => buildAssignmentCatalogTree(books), [books]);
    const leaves = useMemo(() => flattenCatalogTree(tree), [tree]);
    const [selectedGrade, setSelectedGrade] = useState<CatalogGrade | null>(null);
    const [selectedCourse, setSelectedCourse] = useState('');
    const [selectedMaterial, setSelectedMaterial] = useState<AssignmentCatalogMaterial | null>(null);
    const [selectedMajorKey, setSelectedMajorKey] = useState('');
    const [selectedMiddleKeys, setSelectedMiddleKeys] = useState<Set<string>>(() => new Set());
    const [activeMiddleKey, setActiveMiddleKey] = useState('');
    const [query, setQuery] = useState('');
    const displayedCourseLabels = buildCourseLabels(leaves, selectedGrade ? new Set([selectedGrade]) : new Set());
    const courseScopedLeaves = leaves.filter((leaf) => (
        leaf.grade === selectedGrade && leaf.courseLabel === selectedCourse
    ));
    const scopedLeaves = courseScopedLeaves.filter((leaf) => leaf.material === selectedMaterial);
    const majorOptions = buildMajorOptions(scopedLeaves);
    const allMiddleOptions = buildMiddleOptions(majorOptions, new Set(majorOptions.map((major) => major.key)));
    const middleOptions = allMiddleOptions.filter((middle) => middle.majorKey === selectedMajorKey);
    const selectedMiddleOptions = allMiddleOptions.filter((middle) => selectedMiddleKeys.has(middle.key));
    const typeSections = buildTypeSections(
        selectedMiddleOptions,
        activeMiddleKey ? new Set([activeMiddleKey]) : new Set(),
        query,
    );
    const majorSections = [...majorOptions.reduce((sections, option) => {
        const key = `${option.grade}\u0000${option.courseLabel}`;
        const current = sections.get(key) || { key, label: `${option.grade} · ${option.courseLabel}`, options: [] as CatalogMajorOption[] };
        current.options.push(option);
        sections.set(key, current);
        return sections;
    }, new Map<string, { key: string; label: string; options: CatalogMajorOption[] }>()).values()];
    const middleSections = [...middleOptions.reduce((sections, option) => {
        const current = sections.get(option.majorKey) || {
            key: option.majorKey,
            label: `${option.grade} · ${option.courseLabel} · ${option.majorLabel}`,
            options: [] as CatalogMiddleOption[],
        };
        current.options.push(option);
        sections.set(option.majorKey, current);
        return sections;
    }, new Map<string, { key: string; label: string; options: CatalogMiddleOption[] }>()).values()];

    const courseHasData = (course: string) => leaves.some((leaf) => (
        leaf.grade === selectedGrade && leaf.courseLabel === course
    ));
    const materialHasData = (material: AssignmentCatalogMaterial) => courseScopedLeaves.some((leaf) => leaf.material === material);

    const selectGrade = (grade: CatalogGrade) => {
        if (grade === selectedGrade) return;
        setSelectedGrade(grade);
        setSelectedCourse('');
        setSelectedMaterial(null);
        setSelectedMajorKey('');
        setSelectedMiddleKeys(new Set());
        setActiveMiddleKey('');
        setQuery('');
    };
    const selectCourse = (course: string) => {
        if (course === selectedCourse) return;
        setSelectedCourse(course);
        setSelectedMaterial(null);
        setSelectedMajorKey('');
        setSelectedMiddleKeys(new Set());
        setActiveMiddleKey('');
        setQuery('');
    };
    const selectMaterial = (material: AssignmentCatalogMaterial) => {
        if (material === selectedMaterial) return;
        setSelectedMaterial(material);
        setSelectedMajorKey('');
        setSelectedMiddleKeys(new Set());
        setActiveMiddleKey('');
        setQuery('');
    };
    const selectMajor = (majorKey: string) => {
        setSelectedMajorKey(majorKey);
        setQuery('');
    };
    const selectMiddle = (middleKey: string) => {
        setSelectedMiddleKeys((current) => new Set([...current, middleKey]));
        setActiveMiddleKey(middleKey);
        setQuery('');
    };
    const removeMiddle = (middleKey: string) => {
        const removedMiddle = selectedMiddleOptions.find((middle) => middle.key === middleKey);
        if (removedMiddle) onRemoveMiddle(removedMiddle.leaves);
        const remainingKeys = [...selectedMiddleKeys].filter((key) => key !== middleKey);
        setSelectedMiddleKeys(new Set(remainingKeys));
        if (activeMiddleKey === middleKey) setActiveMiddleKey(remainingKeys[0] || '');
        setQuery('');
    };

    const renderLeaf = (leaf: AssignmentCatalogLeaf) => {
        const selected = selectedBookId === leaf.bookId
            && selectedUnitIds.has(leaf.unitId)
            && (leaf.typeId === null || selectedTypeIds.has(leaf.typeId));
        return (
            <Button
                key={leaf.key}
                type="button"
                variant="outline"
                className={cn(
                    'h-auto w-full justify-start gap-2 whitespace-normal rounded-lg px-3 py-2 text-left hover:border-primary/40 hover:bg-primary-soft/60',
                    selected ? 'border-primary bg-primary-soft text-primary-strong' : 'border-border bg-background',
                )}
                title={`${leaf.bookTitle} / ${leaf.label}`}
                aria-pressed={selected}
                onClick={() => onSelectLeaf(leaf)}
            >
                <Tags className={cn('h-3.5 w-3.5 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{leaf.label}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{leaf.partLabel}</span>
                {selected && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
            </Button>
        );
    };

    return (
        <div className="space-y-4">
            <section className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="grid w-full grid-cols-[0.55fr_0.6fr_0.8fr_1.4fr_1.45fr]">
                <SelectorColumn step={1} title="학년">
                    <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
                        {GRADE_ORDER.map((grade) => {
                            const selected = selectedGrade === grade;
                            return (
                                <Button
                                    key={grade}
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className={cn(
                                        'h-auto w-full justify-between gap-1 whitespace-normal rounded-md px-2 py-1.5 text-left text-[11px] font-semibold',
                                        selected
                                            ? 'bg-primary text-primary-foreground'
                                            : 'text-foreground hover:bg-primary-soft',
                                    )}
                                    aria-pressed={selected}
                                    onClick={() => selectGrade(grade)}
                                >
                                    <span>{grade}</span>
                                    {selected && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                                </Button>
                            );
                        })}
                    </div>
                </SelectorColumn>

                <SelectorColumn
                    step={2}
                    title={selectedGrade?.startsWith('중')
                        ? '학기'
                        : selectedGrade?.startsWith('고')
                            ? '과목'
                            : '학기·과목'}
                >
                    {selectedGrade ? (
                        <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
                            {displayedCourseLabels.map((course) => {
                                const hasData = courseHasData(course);
                                const selected = selectedCourse === course;
                                return (
                                    <Button
                                        key={course}
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={!hasData}
                                        className={cn(
                                            'h-auto w-full justify-between gap-1 whitespace-normal rounded-md px-2 py-1.5 text-left text-[11px] font-semibold',
                                            selected && 'bg-primary-soft text-primary-strong',
                                            !selected && hasData && 'text-foreground hover:bg-primary-soft/60',
                                            !hasData && 'cursor-not-allowed text-muted-foreground/35',
                                        )}
                                        aria-pressed={selected}
                                        onClick={() => selectCourse(course)}
                                    >
                                        <span className="min-w-0 break-keep">{course}</span>
                                        {selected && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                                    </Button>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="px-2 py-3 text-xs text-muted-foreground">학년을 선택하세요.</p>
                    )}
                </SelectorColumn>

                <SelectorColumn step={3} title="자료 구분">
                    {selectedCourse ? (
                        <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
                            {MATERIAL_OPTIONS.map((material) => {
                                const hasData = materialHasData(material.key);
                                const selected = selectedMaterial === material.key;
                                const Icon = material.key === 'bank' ? Database : BookOpen;
                                return (
                                    <Button
                                        key={material.key}
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={!hasData}
                                        className={cn(
                                            'h-auto w-full min-w-0 justify-start gap-1.5 whitespace-normal rounded-md px-2 py-1.5 text-left text-[11px] font-semibold',
                                            selected && 'bg-primary-soft text-primary-strong',
                                            !selected && hasData && 'text-foreground hover:bg-primary-soft/60',
                                            !hasData && 'cursor-not-allowed text-muted-foreground/35',
                                        )}
                                        aria-pressed={selected}
                                        onClick={() => selectMaterial(material.key)}
                                    >
                                        <Icon className="h-4 w-4 shrink-0" />
                                        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{material.label}</span>
                                        {selected && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                                    </Button>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="px-2 py-3 text-xs text-muted-foreground">학기 또는 과목을 선택하세요.</p>
                    )}
                </SelectorColumn>

                <SelectorColumn step={4} title="대단원">
                    {!selectedMaterial ? (
                        <p className="px-2 py-3 text-xs text-muted-foreground">자료 구분을 선택하세요.</p>
                    ) : majorSections.length === 0 ? (
                        <p className="px-2 py-3 text-xs text-muted-foreground">등록된 단원이 없습니다.</p>
                    ) : (
                        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                            {majorSections.map((section) => (
                                <div key={section.key}>
                                    <p className="sticky top-0 z-10 mb-0.5 border-y border-border bg-muted px-2 py-1 text-[9px] font-bold text-muted-foreground">
                                        {section.label}
                                    </p>
                                    <div className="space-y-0.5">
                                    {section.options.map((major) => {
                                        const selected = selectedMajorKey === major.key;
                                        return (
                                            <Button
                                                key={major.key}
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className={cn(
                                                    'h-auto w-full items-start justify-start gap-1.5 whitespace-normal rounded-md px-2 py-1.5 text-left text-[11px] font-semibold leading-snug',
                                                    selected
                                                        ? 'bg-primary-soft text-primary-strong'
                                                        : 'text-foreground hover:bg-primary-soft/60',
                                                )}
                                                aria-pressed={selected}
                                                onClick={() => selectMajor(major.key)}
                                            >
                                                <Folder className="h-3.5 w-3.5 shrink-0 text-warning" />
                                                <span className="min-w-0 flex-1 whitespace-normal break-keep">{major.label}</span>
                                                {selected && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                                            </Button>
                                        );
                                    })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </SelectorColumn>

                <SelectorColumn step={5} title="중단원" className="border-r-0">
                    {!selectedMajorKey ? (
                        <p className="px-2 py-3 text-xs text-muted-foreground">대단원을 선택하세요.</p>
                    ) : (
                        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                            {middleSections.map((section) => (
                                <div key={section.key}>
                                    <p className="sticky top-0 z-10 mb-0.5 border-y border-border bg-muted px-2 py-1 text-[9px] font-bold text-muted-foreground" title={section.label}>
                                        <span className="block truncate">{section.label}</span>
                                    </p>
                                    <div className="space-y-0.5">
                                    {section.options.map((middle) => {
                                        const selected = activeMiddleKey === middle.key;
                                        const added = selectedMiddleKeys.has(middle.key);
                                        return (
                                            <Button
                                                key={middle.key}
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className={cn(
                                                    'h-auto w-full items-start justify-start gap-1.5 whitespace-normal rounded-md px-2 py-1.5 text-left text-[11px] font-semibold leading-snug',
                                                    selected
                                                        ? 'bg-primary-soft text-primary-strong'
                                                        : 'text-foreground hover:bg-primary-soft/60',
                                                )}
                                                aria-pressed={added}
                                                onClick={() => selectMiddle(middle.key)}
                                            >
                                                <Folder className="h-3.5 w-3.5 shrink-0 text-warning" />
                                                <span className="min-w-0 flex-1 whitespace-normal break-keep">{middle.label}</span>
                                                {added && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                                            </Button>
                                        );
                                    })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </SelectorColumn>
                </div>
            </section>

            <section className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p className="text-sm font-bold text-foreground">선택한 중단원과 유형</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            {selectedMiddleOptions.length > 0
                                ? '중단원을 하나씩 열어 배포할 세부 유형을 선택하세요.'
                                : '위 폴더에서 중단원까지 선택하세요.'}
                        </p>
                    </div>
                    {activeMiddleKey && (
                        <div className="relative w-full sm:w-64">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="유형 검색" />
                        </div>
                    )}
                </div>
                <div className="p-3">
                    {selectedMiddleOptions.length === 0 ? (
                        <p className="rounded-lg border border-dashed bg-muted/25 p-6 text-center text-xs text-muted-foreground">
                            중단원을 선택하면 이곳에 목록으로 추가됩니다.
                        </p>
                    ) : (
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-bold text-foreground">선택한 중단원</p>
                                    <span className="text-[11px] text-muted-foreground">{selectedMiddleOptions.length}개</span>
                                </div>
                                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                                    {selectedMiddleOptions.map((middle) => {
                                        const active = activeMiddleKey === middle.key;
                                        return (
                                            <div
                                                key={middle.key}
                                                className={cn(
                                                    'flex min-w-0 items-stretch overflow-hidden rounded-lg border bg-background',
                                                    active ? 'border-primary' : 'border-border',
                                                )}
                                            >
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    className={cn(
                                                        'h-auto min-w-0 flex-1 justify-start rounded-none px-3 py-2 text-left',
                                                        active && 'bg-primary-soft text-primary-strong',
                                                    )}
                                                    aria-pressed={active}
                                                    onClick={() => {
                                                        setActiveMiddleKey(middle.key);
                                                        setQuery('');
                                                    }}
                                                >
                                                    <Folder className="h-4 w-4 shrink-0 text-warning" />
                                                    <span className="min-w-0">
                                                        <span className="block truncate text-xs font-semibold">{middle.label}</span>
                                                        <span className="block truncate text-[10px] text-muted-foreground">{middle.majorLabel}</span>
                                                    </span>
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon-sm"
                                                    className="h-auto shrink-0 rounded-none border-l border-border"
                                                    aria-label={`${middle.label} 선택 목록에서 제거`}
                                                    title="선택 목록에서 제거"
                                                    onClick={() => removeMiddle(middle.key)}
                                                >
                                                    <span aria-hidden="true" className="text-base leading-none">×</span>
                                                </Button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="border-t border-border pt-4">
                                {typeSections.length === 0 ? (
                                    <p className="rounded-lg border border-dashed bg-muted/25 p-6 text-center text-xs text-muted-foreground">
                                        검색 결과가 없습니다.
                                    </p>
                                ) : (
                                    <div className="max-h-[48rem] space-y-3 overflow-y-auto pr-1">
                                        {typeSections.map((section) => (
                                            <section key={section.key} className="overflow-hidden rounded-lg border border-border bg-background">
                                                <div className="flex min-w-0 items-center gap-2 border-b border-border bg-muted/35 px-3 py-1.5">
                                                    <span className="shrink-0 rounded bg-primary-soft px-1.5 py-0.5 text-[9px] font-bold text-primary-strong">
                                                        {section.contextLabel}
                                                    </span>
                                                    <span className="min-w-0 truncate text-[10px] font-semibold text-muted-foreground" title={section.pathLabel}>
                                                        {section.pathLabel}
                                                    </span>
                                                </div>
                                                <div className="grid gap-2 p-2 md:grid-cols-2 xl:grid-cols-3">
                                                    {section.leaves.map(renderLeaf)}
                                                </div>
                                            </section>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}
