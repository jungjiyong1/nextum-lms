'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState, ErrorState } from '@/components/ui/state';
import {
    buildPresetBandPlan,
    type WorksheetDifficultyPreset,
} from '@/lib/lms/worksheet-selection';
import type { ChallengeBand } from '@/lib/lms/learning-evidence';
import {
    createWorksheetDraft,
    loadWorksheetCart,
    publishWorksheetDraft,
    renderWorksheetDraft,
} from './worksheet-service';
import type {
    WorksheetCart,
    WorksheetCartBandPlan,
    WorksheetCartItem,
    WorksheetCartItemOverride,
    WorksheetCartProblem,
    WorksheetDraftCreated,
    WorksheetDraftSelectionChange,
    WorksheetPublishResult,
    WorksheetRenderResult,
} from './worksheet-types';

function academyIdOf(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
}

const PURPOSE_LABELS: Record<WorksheetCartItem['purpose'], string> = {
    verification: '독립 확인',
    practice: '교정·연습',
    review: '유지 복습',
};

const STATE_BADGES: Record<WorksheetCartItem['state'], { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
    eligible: { label: '자격', tone: 'success' },
    delayed: { label: '지연', tone: 'warning' },
    locked: { label: '잠금', tone: 'neutral' },
};

const CHANGE_REASONS = [
    { value: 'image_quality', label: '이미지 품질' },
    { value: 'difficulty_mismatch', label: '난이도 부적합' },
    { value: 'duplicate_similar', label: '유사 문제 중복' },
    { value: 'other', label: '기타' },
] as const;

const PROBLEMS_PER_PAGE = 4;
const MINUTES_PER_PROBLEM = 2;

const BANDS: readonly ChallengeBand[] = [1, 2, 3, 4];
const BAND_LABELS: Record<number, string> = { 1: '하', 2: '중', 3: '상', 4: '최상' };
// primary 토큰의 농도 단계로 난이도를 표현한다 (다크 모드 토큰 자동 대응)
const BAND_BAR_ALPHA: Record<number, number> = { 1: 0.25, 2: 0.5, 3: 0.75, 4: 1 };

const DIFFICULTY_PRESETS: ReadonlyArray<{ value: WorksheetDifficultyPreset; label: string }> = [
    { value: 'easier', label: '더 쉽게' },
    { value: 'recommended', label: '추천' },
    { value: 'harder', label: '더 어렵게' },
];

type DifficultyMode = WorksheetDifficultyPreset | 'custom';

interface ItemSelection {
    included: boolean;
    problems: WorksheetCartProblem[];
    unusedAlternates: WorksheetCartProblem[];
    changeLog: WorksheetDraftSelectionChange[];
    difficultyMode: DifficultyMode;
    bandPlan: WorksheetCartBandPlan | null;
    adjusting: boolean;
}

function countProblemsByBand(problems: readonly WorksheetCartProblem[]): Record<number, number> {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const problem of problems) {
        if (counts[problem.challengeBand] !== undefined) counts[problem.challengeBand] += 1;
    }
    return counts;
}

interface PendingChange {
    itemKey: string;
    problemId: string;
    event: 'replaced' | 'removed';
}

function itemKey(item: WorksheetCartItem): string {
    return `${item.analysisSkillId}:${item.purpose}`;
}

function ProblemRow({
    problem,
    onReplace,
    onRemove,
    canReplace,
}: {
    problem: WorksheetCartProblem;
    onReplace: () => void;
    onRemove: () => void;
    canReplace: boolean;
}) {
    const location = [
        problem.bookTitle,
        problem.pagePrinted === null ? null : `p.${problem.pagePrinted}`,
        problem.number === null ? null : `${problem.number}번`,
    ].filter(Boolean).join(' · ');

    return (
        <div className="group relative flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
            <StatusBadge label={`난이도 ${problem.challengeBand}`} tone="info" icon={false} />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {location || problem.problemId}
            </span>
            {problem.imageUrl ? (
                <div className="pointer-events-none absolute left-0 top-full z-20 hidden max-h-64 w-80 overflow-hidden rounded-md border border-border bg-card p-2 shadow-lg group-hover:block">
                    {/* eslint-disable-next-line @next/next/no-img-element -- 짧은 만료의 서명 URL 미리보기 */}
                    <img
                        src={problem.imageUrl}
                        alt="문제 미리보기"
                        className="max-h-60 w-full object-contain"
                    />
                </div>
            ) : null}
            <Button variant="outline" size="sm" onClick={onReplace} disabled={!canReplace}>
                교체
            </Button>
            <Button variant="outline" size="sm" onClick={onRemove}>
                제외
            </Button>
        </div>
    );
}

export function WorksheetCartPage({ studentId }: { studentId: string }) {
    const { profile } = useAuth();
    const academyId = academyIdOf(profile?.current_academy_id);

    const [cart, setCart] = useState<WorksheetCart | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [selections, setSelections] = useState<Map<string, ItemSelection>>(new Map());
    const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
    const [pendingReason, setPendingReason] = useState<string>('image_quality');
    const [creating, setCreating] = useState(false);
    const [created, setCreated] = useState<WorksheetDraftCreated | null>(null);
    const [rendering, setRendering] = useState(false);
    const [renderResult, setRenderResult] = useState<WorksheetRenderResult | null>(null);
    const [publishConfirming, setPublishConfirming] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [publishResult, setPublishResult] = useState<WorksheetPublishResult | null>(null);

    const [recomputing, setRecomputing] = useState(false);

    const buildSelections = useCallback((
        data: WorksheetCart,
        prior?: Map<string, ItemSelection>,
    ): Map<string, ItemSelection> => {
        const next = new Map<string, ItemSelection>();
        for (const item of data.items) {
            const key = itemKey(item);
            const previous = prior?.get(key);
            next.set(key, {
                included: previous?.included
                    ?? (item.state !== 'locked' && !item.verificationBlocked),
                problems: [...item.problems],
                unusedAlternates: [...item.alternates],
                changeLog: [],
                difficultyMode: previous?.difficultyMode ?? 'recommended',
                bandPlan: previous?.bandPlan ?? null,
                adjusting: previous?.adjusting ?? false,
            });
        }
        return next;
    }, []);

    const loadCart = useCallback(async () => {
        if (!academyId || !studentId) return;
        setLoading(true);
        setLoadError(null);
        try {
            const data = await loadWorksheetCart(academyId, studentId);
            setCart(data);
            setSelections(buildSelections(data));
        } catch (error) {
            console.error('학습지 장바구니 로드 실패:', error);
            setLoadError(error instanceof Error ? error.message : '장바구니를 불러오지 못했습니다.');
        } finally {
            setLoading(false);
        }
    }, [academyId, studentId, buildSelections]);

    useEffect(() => {
        void loadCart();
    }, [loadCart]);

    // 난이도 계획이 바뀌면 같은 시드로 전체 장바구니를 다시 계산한다.
    // (항목 간 중복 방지가 유지되도록 부분 재계산 대신 전체 재계산)
    const recomputeWithDifficulty = useCallback(async (
        nextSelections: Map<string, ItemSelection>,
    ) => {
        if (!academyId || !cart) return;
        setSelections(nextSelections);
        setRecomputing(true);
        try {
            const overrides: WorksheetCartItemOverride[] = [];
            for (const item of cart.items) {
                const selection = nextSelections.get(itemKey(item));
                if (selection?.bandPlan) {
                    overrides.push({
                        analysisSkillId: item.analysisSkillId,
                        purpose: item.purpose,
                        bandPlan: selection.bandPlan,
                    });
                }
            }
            const data = await loadWorksheetCart(academyId, cart.studentId, {
                asOf: cart.asOf,
                seed: cart.seed,
                overrides,
            });
            setCart(data);
            setSelections(buildSelections(data, nextSelections));
        } catch (error) {
            console.error('난이도 재계산 실패:', error);
            toast.error(error instanceof Error ? error.message : '난이도 구성을 적용하지 못했습니다.');
        } finally {
            setRecomputing(false);
        }
    }, [academyId, cart, buildSelections]);

    const applyPreset = useCallback((item: WorksheetCartItem, preset: WorksheetDifficultyPreset) => {
        const key = itemKey(item);
        const selection = selections.get(key);
        if (!selection) return;
        const bandPlan = preset === 'recommended'
            ? null
            : (buildPresetBandPlan(
                preset,
                item.suggestedChallengeBand as ChallengeBand,
                item.suggestedItemCount,
            ) as WorksheetCartBandPlan);
        const next = new Map(selections);
        next.set(key, { ...selection, difficultyMode: preset, bandPlan });
        void recomputeWithDifficulty(next);
    }, [selections, recomputeWithDifficulty]);

    const stepBand = useCallback((item: WorksheetCartItem, band: ChallengeBand, delta: number) => {
        const key = itemKey(item);
        const selection = selections.get(key);
        if (!selection || !cart) return;
        const base: WorksheetCartBandPlan = selection.bandPlan
            ? { ...selection.bandPlan }
            : countProblemsByBand(selection.problems);
        const available = item.bandAvailability[band] ?? 0;
        const nextValue = Math.max(0, Math.min((base[band] ?? 0) + delta, Math.max(available, base[band] ?? 0)));
        base[band] = nextValue;
        const total = BANDS.reduce((sum, value) => sum + (base[value] ?? 0), 0);
        if (total < 1 || total > cart.config.manualMaxTotalItems) return;
        const next = new Map(selections);
        next.set(key, { ...selection, difficultyMode: 'custom', bandPlan: base });
        void recomputeWithDifficulty(next);
    }, [selections, cart, recomputeWithDifficulty]);

    const applyPendingChange = useCallback(() => {
        if (!pendingChange) return;
        setSelections((current) => {
            const next = new Map(current);
            const selection = next.get(pendingChange.itemKey);
            if (!selection) return current;
            const change: WorksheetDraftSelectionChange = {
                problemId: pendingChange.problemId,
                event: pendingChange.event,
                reasonCode: pendingReason,
            };
            if (pendingChange.event === 'removed') {
                next.set(pendingChange.itemKey, {
                    ...selection,
                    problems: selection.problems.filter(
                        (problem) => problem.problemId !== pendingChange.problemId,
                    ),
                    changeLog: [...selection.changeLog, change],
                });
                return next;
            }
            const [replacement, ...restAlternates] = selection.unusedAlternates;
            if (!replacement) return current;
            next.set(pendingChange.itemKey, {
                ...selection,
                problems: selection.problems.map((problem) =>
                    problem.problemId === pendingChange.problemId ? replacement : problem,
                ),
                unusedAlternates: restAlternates,
                changeLog: [...selection.changeLog, change],
            });
            return next;
        });
        setPendingChange(null);
    }, [pendingChange, pendingReason]);

    const totals = useMemo(() => {
        let count = 0;
        const bands: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
        for (const [, selection] of selections) {
            if (!selection.included) continue;
            count += selection.problems.length;
            for (const problem of selection.problems) {
                if (bands[problem.challengeBand] !== undefined) bands[problem.challengeBand] += 1;
            }
        }
        return {
            count,
            bands,
            pages: Math.max(1, Math.ceil(count / PROBLEMS_PER_PAGE)),
            minutes: count * MINUTES_PER_PROBLEM,
        };
    }, [selections]);

    const submit = useCallback(async () => {
        if (!academyId || !cart) return;
        const payload = cart.items.flatMap((item) => {
            const selection = selections.get(itemKey(item));
            if (!selection || !selection.included || selection.problems.length === 0) return [];
            return [{
                analysisSkillId: item.analysisSkillId,
                purpose: item.purpose,
                problemIds: selection.problems.map((problem) => problem.problemId),
                changeLog: selection.changeLog,
                ...(selection.bandPlan ? { bandPlan: selection.bandPlan } : {}),
            }];
        });
        if (payload.length === 0) {
            toast.error('학습지에 담을 항목을 선택하세요.');
            return;
        }

        setCreating(true);
        try {
            const result = await createWorksheetDraft(academyId, {
                studentId: cart.studentId,
                asOf: cart.asOf,
                seed: cart.seed,
                selections: payload,
            });
            setCreated(result);
            toast.success('학습지 초안이 저장되었습니다.');
        } catch (error) {
            console.error('학습지 초안 생성 실패:', error);
            toast.error(error instanceof Error ? error.message : '학습지 초안을 만들지 못했습니다.');
        } finally {
            setCreating(false);
        }
    }, [academyId, cart, selections]);

    if (!studentId) {
        return (
            <PageShell title="학습지 만들기">
                <ErrorState title="학생 정보가 없습니다" description="학생 상세 화면에서 다시 시도하세요." />
            </PageShell>
        );
    }

    if (loading) {
        return (
            <PageShell title="학습지 만들기">
                <div className="space-y-3">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                </div>
            </PageShell>
        );
    }

    if (loadError || !cart) {
        return (
            <PageShell title="학습지 만들기">
                <ErrorState
                    title="장바구니를 불러오지 못했습니다"
                    description={loadError ?? undefined}
                    onRetry={() => void loadCart()}
                />
            </PageShell>
        );
    }

    if (created) {
        const studentPdf = renderResult?.artifacts.find((artifact) => artifact.kind === 'student_pdf');
        const answerKey = renderResult?.artifacts.find((artifact) => artifact.kind === 'answer_key');
        return (
            <PageShell title="학습지 만들기" subtitle={`${cart.studentName} 학생`}>
                <Card>
                    <CardHeader>
                        <CardTitle>
                            {publishResult
                                ? '배포 완료 — 학생 앱에 과제가 등록되었습니다'
                                : renderResult
                                    ? 'PDF가 준비되었습니다 — 검수 후 인쇄·배포하세요'
                                    : '학습지 초안이 저장되었습니다'}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm text-muted-foreground">
                        <p>버전 코드 <span className="font-medium text-foreground">{created.versionCode}</span> · {created.itemCount}문항</p>
                        {renderResult ? (
                            <>
                                {renderResult.warnings.map((warning) => (
                                    <p key={warning} className="text-warning-foreground">⚠ {warning}</p>
                                ))}
                                <p>
                                    학생용 {studentPdf?.pageCount ?? '-'}페이지 · 열기 후 실제 인쇄 상태를 확인하고 배부하세요.
                                    링크는 10분 뒤 만료됩니다.
                                </p>
                            </>
                        ) : (
                            <p>PDF를 생성하면 검수용 미리보기와 교사용 정답지가 함께 만들어집니다.</p>
                        )}
                        {publishResult ? (
                            <p>
                                지면 번호와 앱 문항 순서가 같게 등록되었습니다. 학생은 종이로 풀고
                                Grade App에서 같은 번호에 답을 입력하면 됩니다.
                            </p>
                        ) : null}
                        {renderResult && !publishResult ? (
                            publishConfirming ? (
                                <div className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2">
                                    <p className="text-sm text-warning-foreground">
                                        배포하면 학생 앱에 과제가 등록되고 이 학습지는 더 이상 수정할 수
                                        없습니다. 인쇄물 검수를 마쳤나요?
                                    </p>
                                    <div className="mt-2 flex gap-2">
                                        <Button
                                            size="sm"
                                            disabled={publishing}
                                            onClick={async () => {
                                                if (!academyId) return;
                                                setPublishing(true);
                                                try {
                                                    setPublishResult(
                                                        await publishWorksheetDraft(academyId, created.draftId),
                                                    );
                                                    toast.success('학습지가 배포되었습니다.');
                                                } catch (error) {
                                                    console.error('학습지 배포 실패:', error);
                                                    toast.error(error instanceof Error ? error.message : '배포에 실패했습니다.');
                                                } finally {
                                                    setPublishing(false);
                                                    setPublishConfirming(false);
                                                }
                                            }}
                                        >
                                            {publishing ? '배포 중…' : '배포 확정'}
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={() => setPublishConfirming(false)}>
                                            취소
                                        </Button>
                                    </div>
                                </div>
                            ) : null
                        ) : null}
                        <div className="flex flex-wrap gap-2 pt-2">
                            {renderResult ? (
                                <>
                                    {studentPdf?.url ? (
                                        <Button asChild variant={publishResult ? 'default' : 'outline'}>
                                            <a href={studentPdf.url} target="_blank" rel="noreferrer">
                                                학생용 PDF {publishResult ? '인쇄' : '검수·인쇄'}
                                            </a>
                                        </Button>
                                    ) : null}
                                    {answerKey?.url ? (
                                        <Button asChild variant="outline">
                                            <a href={answerKey.url} target="_blank" rel="noreferrer">
                                                정답지 (교사용)
                                            </a>
                                        </Button>
                                    ) : null}
                                    {!publishResult && !publishConfirming ? (
                                        <Button onClick={() => setPublishConfirming(true)}>
                                            Grade App으로 배포
                                        </Button>
                                    ) : null}
                                </>
                            ) : (
                                <Button
                                    disabled={rendering}
                                    onClick={async () => {
                                        if (!academyId) return;
                                        setRendering(true);
                                        try {
                                            setRenderResult(await renderWorksheetDraft(academyId, created.draftId));
                                            toast.success('PDF가 생성되었습니다.');
                                        } catch (error) {
                                            console.error('학습지 렌더 실패:', error);
                                            toast.error(error instanceof Error ? error.message : 'PDF 생성에 실패했습니다.');
                                        } finally {
                                            setRendering(false);
                                        }
                                    }}
                                >
                                    {rendering ? 'PDF 생성 중… (최대 수십 초)' : 'PDF 생성'}
                                </Button>
                            )}
                            <Button asChild variant="outline">
                                <Link href={`/students/${cart.studentId}`}>학생 상세로</Link>
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setCreated(null);
                                    setRenderResult(null);
                                    setPublishResult(null);
                                    setPublishConfirming(false);
                                    void loadCart();
                                }}
                            >
                                새 학습지 만들기
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </PageShell>
        );
    }

    if (!cart.problemBankGranted) {
        return (
            <PageShell title="학습지 만들기" subtitle={`${cart.studentName} 학생`}>
                <EmptyState
                    title="문제은행 사용 승인이 필요합니다"
                    description="이 학원은 아직 문제은행 사용 승인을 받지 않았습니다. 최고 관리자에게 승인을 요청하세요."
                />
            </PageShell>
        );
    }

    return (
        <PageShell
            title="학습지 만들기"
            subtitle={`${cart.studentName} 학생 · ${cart.asOf} 기준 추천`}
        >
            <div className="space-y-4 pb-28">
                {cart.items.length === 0 ? (
                    <EmptyState
                        title="추천할 항목이 없습니다"
                        description="아직 학습 증거가 부족하거나 자격이 된 유형이 없습니다."
                    />
                ) : null}

                {cart.items.map((item) => {
                    const key = itemKey(item);
                    const selection = selections.get(key);
                    if (!selection) return null;
                    const badge = STATE_BADGES[item.state];
                    const disabled = item.verificationBlocked;

                    return (
                        <Card key={key}>
                            <CardHeader className="pb-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Checkbox
                                        checked={selection.included}
                                        disabled={disabled}
                                        onCheckedChange={(checked) => {
                                            setSelections((current) => {
                                                const next = new Map(current);
                                                next.set(key, { ...selection, included: checked === true });
                                                return next;
                                            });
                                        }}
                                        aria-label={`${item.skillName} ${PURPOSE_LABELS[item.purpose]} 포함`}
                                    />
                                    <CardTitle className="text-base">{item.skillName}</CardTitle>
                                    <StatusBadge label={PURPOSE_LABELS[item.purpose]} tone="primary" icon={false} />
                                    <StatusBadge label={badge.label} tone={badge.tone} icon={false} />
                                    <span className="text-xs text-muted-foreground">{item.basisSummary}</span>
                                </div>
                                {item.state === 'locked' && selection.included ? (
                                    <p className="text-xs text-muted-foreground">
                                        아직 확인 자격이 없어 포함 시 연습 문항으로 저장되고 확인 증거로 쓰이지 않습니다.
                                    </p>
                                ) : null}
                                {item.verificationBlocked ? (
                                    <p className="text-xs text-muted-foreground">
                                        확인 불가 · 미풀이 문항 부족 — 새 문제가 확보되면 다시 제안됩니다.
                                    </p>
                                ) : null}
                                {item.warnings.map((warning) => (
                                    <p key={warning.code} className="text-xs text-muted-foreground">
                                        {warning.detail}
                                    </p>
                                ))}
                                {!item.verificationBlocked ? (
                                    <div className="space-y-2 pt-1">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <span className="text-xs text-muted-foreground">난이도 구성</span>
                                            <div className="flex items-end gap-1" aria-hidden="true">
                                                {BANDS.map((band) => {
                                                    const count = countProblemsByBand(selection.problems)[band] ?? 0;
                                                    return (
                                                        <div
                                                            key={band}
                                                            className={count > 0 ? 'w-6 rounded-sm' : 'w-6 rounded-sm bg-muted'}
                                                            style={{
                                                                height: `${4 + count * 6}px`,
                                                                ...(count > 0
                                                                    ? { background: `hsl(var(--primary) / ${BAND_BAR_ALPHA[band]})` }
                                                                    : {}),
                                                            }}
                                                        />
                                                    );
                                                })}
                                            </div>
                                            <span className="text-xs font-medium text-foreground">
                                                {BANDS
                                                    .map((band) => `${BAND_LABELS[band]} ${countProblemsByBand(selection.problems)[band] ?? 0}`)
                                                    .join(' · ')}
                                            </span>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <div className="inline-flex items-center gap-0.5 rounded-xl bg-muted p-0.5">
                                                {DIFFICULTY_PRESETS.map((preset) => (
                                                    <Button
                                                        key={preset.value}
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        disabled={recomputing}
                                                        className={selection.difficultyMode === preset.value
                                                            ? 'h-8 rounded-[10px] bg-card text-primary-strong shadow-sm hover:bg-card'
                                                            : 'h-8 rounded-[10px]'}
                                                        onClick={() => applyPreset(item, preset.value)}
                                                    >
                                                        {preset.label}
                                                    </Button>
                                                ))}
                                            </div>
                                            <Button
                                                type="button"
                                                variant={selection.difficultyMode === 'custom' ? 'secondary' : 'outline'}
                                                size="sm"
                                                className="h-8"
                                                disabled={recomputing}
                                                onClick={() => {
                                                    setSelections((current) => {
                                                        const next = new Map(current);
                                                        next.set(key, { ...selection, adjusting: !selection.adjusting });
                                                        return next;
                                                    });
                                                }}
                                            >
                                                직접 조정
                                            </Button>
                                            {recomputing ? (
                                                <span className="text-xs text-muted-foreground">다시 뽑는 중…</span>
                                            ) : null}
                                        </div>
                                        {selection.adjusting ? (
                                            <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5">
                                                <div className="grid grid-cols-4 gap-2">
                                                    {BANDS.map((band) => {
                                                        const current = (selection.bandPlan
                                                            ?? countProblemsByBand(selection.problems))[band] ?? 0;
                                                        const isTarget = band === item.suggestedChallengeBand;
                                                        return (
                                                            <div key={band} className="text-center">
                                                                <p className={isTarget
                                                                    ? 'mb-1 text-xs font-medium text-primary-strong'
                                                                    : 'mb-1 text-xs font-medium text-muted-foreground'}>
                                                                    {BAND_LABELS[band]}{isTarget ? ' · 목표' : ''}
                                                                </p>
                                                                <div className="inline-flex items-center gap-1.5">
                                                                    <Button
                                                                        type="button"
                                                                        variant="outline"
                                                                        size="sm"
                                                                        className="h-7 w-7 px-0"
                                                                        disabled={recomputing || current === 0}
                                                                        aria-label={`${BAND_LABELS[band]} 줄이기`}
                                                                        onClick={() => stepBand(item, band, -1)}
                                                                    >
                                                                        −
                                                                    </Button>
                                                                    <span className="min-w-4 text-sm font-semibold">{current}</span>
                                                                    <Button
                                                                        type="button"
                                                                        variant="outline"
                                                                        size="sm"
                                                                        className="h-7 w-7 px-0"
                                                                        disabled={recomputing
                                                                            || current >= (item.bandAvailability[band] ?? 0)}
                                                                        aria-label={`${BAND_LABELS[band]} 늘리기`}
                                                                        onClick={() => stepBand(item, band, 1)}
                                                                    >
                                                                        +
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                <p className="mt-2 text-xs text-muted-foreground">
                                                    후보 문제: {BANDS
                                                        .map((band) => `${BAND_LABELS[band]} ${item.bandAvailability[band] ?? 0}`)
                                                        .join(' · ')} — 부족하면 가까운 난이도로 보충하고 알려드립니다
                                                </p>
                                            </div>
                                        ) : null}
                                        {item.purpose === 'verification' && selection.difficultyMode !== 'recommended' ? (
                                            <div className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2">
                                                <p className="text-xs text-warning-foreground">
                                                    확인 문항의 난이도를 바꾸면 그 난이도 기준으로 실력이 기록됩니다.
                                                    현재 목표는 {BAND_LABELS[item.suggestedChallengeBand]}({item.suggestedChallengeBand})입니다.
                                                </p>
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                            </CardHeader>
                            {selection.problems.length > 0 ? (
                                <CardContent className="space-y-2">
                                    {selection.problems.map((problem) => (
                                        <div key={problem.problemId} className="space-y-2">
                                            <ProblemRow
                                                problem={problem}
                                                canReplace={selection.unusedAlternates.length > 0}
                                                onReplace={() => {
                                                    setPendingChange({ itemKey: key, problemId: problem.problemId, event: 'replaced' });
                                                    setPendingReason('image_quality');
                                                }}
                                                onRemove={() => {
                                                    setPendingChange({ itemKey: key, problemId: problem.problemId, event: 'removed' });
                                                    setPendingReason('image_quality');
                                                }}
                                            />
                                            {pendingChange?.itemKey === key
                                                && pendingChange.problemId === problem.problemId ? (
                                                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                                                    <span className="text-xs text-muted-foreground">
                                                        {pendingChange.event === 'replaced' ? '교체' : '제외'} 사유
                                                    </span>
                                                    <Select value={pendingReason} onValueChange={setPendingReason}>
                                                        <SelectTrigger className="h-8 w-40">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {CHANGE_REASONS.map((reason) => (
                                                                <SelectItem key={reason.value} value={reason.value}>
                                                                    {reason.label}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    <Button size="sm" onClick={applyPendingChange}>확인</Button>
                                                    <Button size="sm" variant="outline" onClick={() => setPendingChange(null)}>
                                                        취소
                                                    </Button>
                                                </div>
                                            ) : null}
                                        </div>
                                    ))}
                                </CardContent>
                            ) : null}
                        </Card>
                    );
                })}

                {cart.excluded.length > 0 ? (
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm">자동 추천 제외</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1">
                            {cart.excluded.map((entry) => (
                                <p key={entry.analysisSkillId} className="text-xs text-muted-foreground">
                                    {entry.skillName} — {entry.reason === 'content_gap' ? '문항 자료 부족' : '분석 데이터 부족'}
                                </p>
                            ))}
                        </CardContent>
                    </Card>
                ) : null}
            </div>

            <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
                <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm text-muted-foreground">
                            총 <span className="font-medium text-foreground">{totals.count}문항</span>
                            {' · '}약 {totals.pages}페이지 · 예상 {totals.minutes}분
                        </p>
                        {BANDS.filter((band) => totals.bands[band] > 0).map((band) => (
                            <StatusBadge
                                key={band}
                                label={`${BAND_LABELS[band]} ${totals.bands[band]}`}
                                tone={band <= 1 ? 'neutral' : band === 2 ? 'info' : 'primary'}
                                icon={false}
                            />
                        ))}
                    </div>
                    <Button onClick={() => void submit()} disabled={creating || recomputing || totals.count === 0}>
                        {creating ? '저장 중…' : '학습지 초안 만들기'}
                    </Button>
                </div>
            </div>
        </PageShell>
    );
}
