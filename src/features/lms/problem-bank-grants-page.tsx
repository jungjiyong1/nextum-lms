'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { loadProblemBankGrants, setProblemBankGrant } from './worksheet-service';
import type { ProblemBankGrantOverview } from './worksheet-types';

export function ProblemBankGrantsPage() {
    const [overview, setOverview] = useState<ProblemBankGrantOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [updatingAcademyId, setUpdatingAcademyId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            setOverview(await loadProblemBankGrants());
        } catch (error) {
            console.error('문제은행 승인 목록 로드 실패:', error);
            setLoadError(
                error instanceof Error ? error.message : '승인 목록을 불러오지 못했습니다.',
            );
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const update = useCallback(async (academyId: string, action: 'grant' | 'revoke') => {
        setUpdatingAcademyId(academyId);
        try {
            await setProblemBankGrant({ academyId, action });
            toast.success(action === 'grant' ? '사용을 승인했습니다.' : '승인을 회수했습니다.');
            await load();
        } catch (error) {
            console.error('문제은행 승인 변경 실패:', error);
            toast.error(error instanceof Error ? error.message : '승인 변경에 실패했습니다.');
        } finally {
            setUpdatingAcademyId(null);
        }
    }, [load]);

    if (loading) {
        return (
            <PageShell title="문제은행 사용 승인">
                <div className="space-y-3">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                </div>
            </PageShell>
        );
    }

    if (loadError || !overview) {
        return (
            <PageShell title="문제은행 사용 승인">
                <ErrorState
                    title="승인 목록을 불러오지 못했습니다"
                    description={loadError ?? '최고 관리자 권한이 필요한 화면입니다.'}
                    onRetry={() => void load()}
                />
            </PageShell>
        );
    }

    return (
        <PageShell
            title="문제은행 사용 승인"
            subtitle="승인된 학원만 이미지 문제은행으로 학습지를 만들 수 있습니다."
        >
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">학원별 상태</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    {overview.academies.length === 0 ? (
                        <EmptyState title="활성 학원이 없습니다" />
                    ) : overview.academies.map((academy) => (
                        <div
                            key={academy.academyId}
                            className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2"
                        >
                            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                                {academy.academyName}
                            </span>
                            <StatusBadge
                                label={academy.granted ? '승인됨' : '미승인'}
                                tone={academy.granted ? 'success' : 'neutral'}
                                icon={false}
                            />
                            {academy.granted ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={updatingAcademyId === academy.academyId}
                                    onClick={() => void update(academy.academyId, 'revoke')}
                                >
                                    회수
                                </Button>
                            ) : (
                                <Button
                                    size="sm"
                                    disabled={updatingAcademyId === academy.academyId}
                                    onClick={() => void update(academy.academyId, 'grant')}
                                >
                                    승인
                                </Button>
                            )}
                        </div>
                    ))}
                </CardContent>
            </Card>
        </PageShell>
    );
}
