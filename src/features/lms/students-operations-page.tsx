'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    BarChart3,
    CalendarDays,
    CreditCard,
    GraduationCap,
    Pencil,
    Plus,
    Search,
    ShieldAlert,
    Trash2,
    UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { PasswordConfirmDialog } from '@/components/security/PasswordConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton, SkeletonPage, SkeletonPanel } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import {
    archiveStudent,
    createStudent,
    hardDeleteStudent,
    loadStudentDetail,
    loadStudentLearningMetrics,
    loadStudentOperationsOverview,
    previewHardDeleteStudent,
    updateStudent,
} from './service';
import type {
    BillingMode,
    ClassSummary,
    StudentDetail,
    StudentDetailSection,
    StudentHardDeletePreview,
    StudentLearningMetric,
    StudentOperationsPermissions,
    StudentStatus,
    StudentSummary,
} from './types';

type StudentFilterStatus = 'operations' | 'all' | StudentStatus;
type StudentSortMode = 'risk' | 'recent' | 'name';
type FormMode = 'create' | 'edit' | null;

const emptyPermissions: StudentOperationsPermissions = {
    canCreate: false,
    canEdit: false,
    canArchive: false,
    canViewBilling: false,
    canHardDelete: false,
    scopedToAssignedClasses: false,
};

const DETAIL_SECTION_BY_TAB: Record<string, StudentDetailSection | null> = {
    learning: 'learning',
    profile: null,
    attendance: 'attendance',
    billing: 'billing',
    manage: 'management',
};

function hasLoadedSection(detail: StudentDetail | null, section: StudentDetailSection): boolean {
    if (!detail) return false;
    return detail.loadedSections.includes('full') || detail.loadedSections.includes(section);
}

function uniqueSections(sections: StudentDetailSection[]): StudentDetailSection[] {
    return [...new Set(sections)];
}

function mergeStudentDetail(current: StudentDetail | null, next: StudentDetail): StudentDetail {
    if (!current || current.summary.id !== next.summary.id) return next;

    const loadedSections = uniqueSections([...current.loadedSections, ...next.loadedSections]);
    const nextLoaded = (section: StudentDetailSection) => next.loadedSections.includes('full') || next.loadedSections.includes(section);

    return {
        summary: {
            ...current.summary,
            ...next.summary,
            weakTypeCount: next.summary.learningMetricsLoaded ? next.summary.weakTypeCount : current.summary.weakTypeCount,
            avgTypeScore: next.summary.learningMetricsLoaded ? next.summary.avgTypeScore : current.summary.avgTypeScore,
            lastLearningAt: next.summary.learningMetricsLoaded ? next.summary.lastLearningAt : current.summary.lastLearningAt,
            learningMetricsLoaded: current.summary.learningMetricsLoaded || next.summary.learningMetricsLoaded,
        },
        permissions: next.permissions,
        loadedSections,
        weakTypes: nextLoaded('learning') ? next.weakTypes : current.weakTypes,
        recentAttempts: nextLoaded('learning') ? next.recentAttempts : current.recentAttempts,
        aiConversations: nextLoaded('learning') ? next.aiConversations : current.aiConversations,
        reports: nextLoaded('learning') ? next.reports : current.reports,
        attendanceSummary: nextLoaded('attendance') ? next.attendanceSummary : current.attendanceSummary,
        recentAttendance: nextLoaded('attendance') ? next.recentAttendance : current.recentAttendance,
        billing: nextLoaded('billing') ? next.billing : current.billing,
        recentPayments: nextLoaded('billing') ? next.recentPayments : current.recentPayments,
        hardDeletePreview: next.hardDeletePreview || current.hardDeletePreview,
    };
}

function academyIdOf(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function currency(value: number | null | undefined): string {
    return `${Math.round(value || 0).toLocaleString()}원`;
}

function shortDate(value: string | null | undefined): string {
    if (!value) return '-';
    return value.slice(0, 10);
}

function statusLabel(status: string): string {
    const labels: Record<string, string> = {
        active: '재원',
        inactive: '중지',
        on_leave: '휴원',
        graduated: '졸업',
        dropped: '퇴원/보관',
        weak: '취약',
        watch: '주의',
        insufficient: '표본 부족',
        ok: '양호',
        present: '출석',
        late: '지각',
        absent: '결석',
        excused: '인정 결석',
        makeup: '보강',
        issued: '청구',
        paid: '완납',
        partial: '부분 납부',
        not_issued: '미발행',
        draft: '초안',
    };
    return labels[status] || status;
}

function billingModeLabel(mode: BillingMode | null): string {
    if (mode === 'monthly_plus_classes') return '기본료 + 반 추가금';
    if (mode === 'usage_based') return '시간제';
    if (mode === 'manual') return '수동 청구';
    return '-';
}

function StatusBadge({ status }: { status: string }) {
    return (
        <span
            className={cn(
                'inline-flex rounded-full px-2.5 py-1 text-xs font-medium',
                ['weak', 'absent', 'dropped', 'failed', 'overdue'].includes(status) && 'bg-red-50 text-red-700',
                ['watch', 'late', 'makeup', 'partial', 'issued'].includes(status) && 'bg-amber-50 text-amber-700',
                ['active', 'ok', 'present', 'paid', 'completed'].includes(status) && 'bg-emerald-50 text-emerald-700',
                ['inactive', 'on_leave', 'graduated', 'insufficient', 'excused', 'not_issued', 'draft'].includes(status) && 'bg-slate-100 text-slate-600',
            )}
        >
            {statusLabel(status)}
        </span>
    );
}

function SelectBox(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
    return (
        <select
            {...props}
            className={cn('h-10 w-full rounded-md border border-input bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-ring', props.className)}
        />
    );
}

function PageShell({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-5 lg:p-8">
            <div className="flex flex-col gap-4 border-b border-border/70 pb-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                        <GraduationCap className="h-5 w-5" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-semibold text-slate-950">학생</h1>
                        <p className="text-sm text-slate-500">학습분석, 출결, 연락처, 청구 계약을 한 화면에서 관리합니다.</p>
                    </div>
                </div>
                {action}
            </div>
            {children}
        </div>
    );
}

function LoadingBlock() {
    return <SkeletonPanel className="min-h-[320px]" rows={6} />;
}

function StudentDetailSkeleton() {
    return (
        <Card className="overflow-hidden">
            <CardHeader className="border-b">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                        <Skeleton className="h-6 w-40" />
                        <Skeleton className="h-4 w-72 max-w-full" />
                    </div>
                    <div className="flex gap-2">
                        <Skeleton className="h-12 w-24" />
                        <Skeleton className="h-12 w-24" />
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-4">
                <div className="mb-4 flex flex-wrap gap-2">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-24" />)}
                </div>
                <SkeletonPanel rows={5} showHeader={false} />
            </CardContent>
        </Card>
    );
}

function StudentTabSkeleton() {
    return <SkeletonPanel rows={4} showHeader={false} />;
}

function EmptyDetail({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) {
    return (
        <Card className="min-h-[520px]">
            <CardContent className="flex h-full min-h-[520px] flex-col items-center justify-center gap-3 text-center">
                <UserRound className="h-9 w-9 text-slate-300" />
                <div>
                    <p className="text-sm font-medium text-slate-700">학생을 선택하세요.</p>
                    <p className="mt-1 text-xs text-slate-400">왼쪽 목록에서 학생을 클릭하면 상세 정보가 열립니다.</p>
                </div>
                {canCreate && (
                    <Button type="button" variant="outline" size="sm" onClick={onCreate}>
                        <Plus className="mr-2 h-4 w-4" />
                        학생 등록
                    </Button>
                )}
            </CardContent>
        </Card>
    );
}

function summarizeRisk(student: StudentSummary): string {
    const weakCount = student.weakTypeCount || 0;
    if (weakCount > 0) return `${weakCount}개 취약`;
    if (student.avgTypeScore !== null && student.avgTypeScore !== undefined) return `${student.avgTypeScore}점`;
    return '데이터 없음';
}

function sortStudents(students: StudentSummary[], sortMode: StudentSortMode): StudentSummary[] {
    return [...students].sort((a, b) => {
        if (sortMode === 'name') return a.name.localeCompare(b.name, 'ko');
        if (sortMode === 'recent') {
            return String(b.lastLearningAt || '').localeCompare(String(a.lastLearningAt || ''));
        }
        return (b.weakTypeCount || 0) - (a.weakTypeCount || 0)
            || (a.avgTypeScore ?? 101) - (b.avgTypeScore ?? 101)
            || a.name.localeCompare(b.name, 'ko');
    });
}

function StudentList({
    students,
    selectedStudentId,
    metricsLoading,
    onSelect,
}: {
    students: StudentSummary[];
    selectedStudentId: string;
    metricsLoading: boolean;
    onSelect: (student: StudentSummary) => void;
}) {
    return (
        <div className="divide-y divide-slate-100 bg-white">
            {students.map((student) => (
                <button
                    key={student.id}
                    type="button"
                    className={cn(
                        'flex w-full appearance-none items-start justify-between gap-3 border-0 bg-white px-4 py-3 text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-200',
                        selectedStudentId === student.id && 'bg-emerald-50/70',
                    )}
                    onClick={() => onSelect(student)}
                >
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-medium text-slate-900">{student.name}</span>
                            <StatusBadge status={student.status} />
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500">{student.classNames.join(', ') || '배정 반 없음'}</p>
                        <p className="mt-1 text-xs text-slate-400">{student.phone || '-'} · 보호자 {student.parentPhone || '-'}</p>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                        {metricsLoading && !student.learningMetricsLoaded ? (
                            <div className="space-y-1">
                                <Skeleton className="ml-auto h-4 w-16" />
                                <Skeleton className="ml-auto h-3 w-20" />
                            </div>
                        ) : (
                            <>
                                <p className={cn('font-medium', (student.weakTypeCount || 0) > 0 ? 'text-red-600' : 'text-slate-500')}>
                                    {summarizeRisk(student)}
                                </p>
                                <p className="mt-1 text-slate-400">{shortDate(student.lastLearningAt)}</p>
                            </>
                        )}
                    </div>
                </button>
            ))}
            {students.length === 0 && (
                <div className="px-4 py-10 text-center text-sm text-slate-400">조건에 맞는 학생이 없습니다.</div>
            )}
        </div>
    );
}

function LearningTab({ detail }: { detail: StudentDetail }) {
    const correctAttempts = detail.recentAttempts.filter((row) => row.correct).length;
    const accuracy = detail.recentAttempts.length > 0
        ? Math.round((correctAttempts / detail.recentAttempts.length) * 100)
        : null;

    return (
        <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-lg border bg-white p-3">
                    <p className="text-xs text-slate-500">취약/주의 유형</p>
                    <p className="mt-1 text-xl font-semibold text-slate-950">{detail.summary.weakTypeCount || 0}개</p>
                </div>
                <div className="rounded-lg border bg-white p-3">
                    <p className="text-xs text-slate-500">평균 유형 점수</p>
                    <p className="mt-1 text-xl font-semibold text-slate-950">{detail.summary.avgTypeScore ?? '-'}점</p>
                </div>
                <div className="rounded-lg border bg-white p-3">
                    <p className="text-xs text-slate-500">최근 풀이 정답률</p>
                    <p className="mt-1 text-xl font-semibold text-slate-950">{accuracy === null ? '-' : `${accuracy}%`}</p>
                </div>
                <div className="rounded-lg border bg-white p-3">
                    <p className="text-xs text-slate-500">AI 대화</p>
                    <p className="mt-1 text-xl font-semibold text-slate-950">{detail.aiConversations.length}건</p>
                </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-lg border bg-white">
                    <div className="border-b px-4 py-3 text-sm font-medium">취약유형</div>
                    <div className="divide-y">
                        {detail.weakTypes.map((row) => (
                            <div key={`${row.typeName}-${row.classId || 'none'}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                                <div className="min-w-0">
                                    <p className="truncate font-medium text-slate-800">{row.typeName}</p>
                                    <p className="text-xs text-slate-400">표본 {row.sampleCount} · 정답 {row.correctCount}</p>
                                </div>
                                <div className="text-right">
                                    <StatusBadge status={row.status} />
                                    <p className="mt-1 text-xs text-slate-500">{row.score ?? '-'}점</p>
                                </div>
                            </div>
                        ))}
                        {detail.weakTypes.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">취약유형 데이터가 없습니다.</p>}
                    </div>
                </div>

                <div className="rounded-lg border bg-white">
                    <div className="border-b px-4 py-3 text-sm font-medium">최근 채점</div>
                    <div className="divide-y">
                        {detail.recentAttempts.map((row) => (
                            <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                                <div className="min-w-0">
                                    <p className="truncate font-medium text-slate-800">{row.problemId}</p>
                                    <p className="text-xs text-slate-400">{shortDate(row.createdAt)} · {row.attemptNo}회차</p>
                                </div>
                                <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', row.correct ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
                                    {row.correct ? '정답' : '오답'}
                                </span>
                            </div>
                        ))}
                        {detail.recentAttempts.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">최근 채점 데이터가 없습니다.</p>}
                    </div>
                </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-lg border bg-white">
                    <div className="border-b px-4 py-3 text-sm font-medium">AI 대화</div>
                    <div className="divide-y">
                        {detail.aiConversations.map((row) => (
                            <div key={row.id} className="px-4 py-3 text-sm">
                                <p className="truncate font-medium text-slate-800">{row.title || '제목 없음'}</p>
                                <p className="text-xs text-slate-400">{row.sourceApp || '-'} · {shortDate(row.updatedAt)}</p>
                            </div>
                        ))}
                        {detail.aiConversations.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">AI 대화 데이터가 없습니다.</p>}
                    </div>
                </div>

                <div className="rounded-lg border bg-white">
                    <div className="border-b px-4 py-3 text-sm font-medium">리포트 소재</div>
                    <div className="divide-y">
                        {detail.reports.map((row) => (
                            <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                                <div className="min-w-0">
                                    <p className="truncate font-medium text-slate-800">{row.title || row.reportType}</p>
                                    <p className="text-xs text-slate-400">{row.reportType} · {shortDate(row.generatedAt)}</p>
                                </div>
                                <StatusBadge status={row.status} />
                            </div>
                        ))}
                        {detail.reports.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">저장된 리포트가 없습니다.</p>}
                    </div>
                </div>
            </div>
        </div>
    );
}

function ProfileTab({ student }: { student: StudentSummary }) {
    return (
        <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border bg-white p-4">
                <p className="text-xs font-medium text-slate-500">학생 정보</p>
                <dl className="mt-3 grid gap-3 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-slate-500">이름</dt><dd className="font-medium">{student.name}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-slate-500">상태</dt><dd><StatusBadge status={student.status} /></dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-slate-500">학년/메모</dt><dd>{student.grade || '-'}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-slate-500">학생 연락처</dt><dd>{student.phone || '-'}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-slate-500">보호자</dt><dd>{student.parentName || '-'}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-slate-500">보호자 연락처</dt><dd>{student.parentPhone || '-'}</dd></div>
                </dl>
            </div>
            <div className="rounded-lg border bg-white p-4">
                <p className="text-xs font-medium text-slate-500">반 배정</p>
                <div className="mt-3 flex flex-wrap gap-2">
                    {student.classNames.map((name) => (
                        <span key={name} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">{name}</span>
                    ))}
                    {student.classNames.length === 0 && <span className="text-sm text-slate-400">배정된 반이 없습니다.</span>}
                </div>
            </div>
        </div>
    );
}

function AttendanceTab({ detail }: { detail: StudentDetail }) {
    const summary = detail.attendanceSummary;
    return (
        <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-5">
                {(['present', 'late', 'absent', 'excused', 'makeup'] as const).map((status) => (
                    <div key={status} className="rounded-lg border bg-white p-3">
                        <p className="text-xs text-slate-500">{statusLabel(status)}</p>
                        <p className="mt-1 text-xl font-semibold text-slate-950">{summary[status]}건</p>
                    </div>
                ))}
            </div>
            <div className="overflow-hidden rounded-lg border bg-white">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                            <th className="px-4 py-3 font-medium">일자</th>
                            <th className="px-4 py-3 font-medium">반</th>
                            <th className="px-4 py-3 font-medium">상태</th>
                            <th className="px-4 py-3 font-medium">시간</th>
                            <th className="px-4 py-3 font-medium">메모</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {detail.recentAttendance.map((row) => (
                            <tr key={row.id}>
                                <td className="px-4 py-3">{row.date}</td>
                                <td className="px-4 py-3">{row.className}</td>
                                <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                                <td className="px-4 py-3 text-slate-600">{row.attendedMinutes ?? 0}분 / {row.billableMinutes ?? 0}분</td>
                                <td className="px-4 py-3 text-slate-500">{row.notes || '-'}</td>
                            </tr>
                        ))}
                        {detail.recentAttendance.length === 0 && (
                            <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">출결 기록이 없습니다.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function BillingTab({ detail }: { detail: StudentDetail }) {
    const student = detail.summary;
    return (
        <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border bg-white p-3">
                    <p className="text-xs text-slate-500">청구 방식</p>
                    <p className="mt-1 text-lg font-semibold text-slate-950">{billingModeLabel(student.billingMode)}</p>
                </div>
                <div className="rounded-lg border bg-white p-3">
                    <p className="text-xs text-slate-500">기본료</p>
                    <p className="mt-1 text-lg font-semibold text-slate-950">{currency(student.baseMonthlyFee)}</p>
                </div>
                <div className="rounded-lg border bg-white p-3">
                    <p className="text-xs text-slate-500">추가 반 금액</p>
                    <p className="mt-1 text-lg font-semibold text-slate-950">{currency(student.extraClassFee)}</p>
                </div>
            </div>
            <div className="rounded-lg border bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="text-sm font-medium text-slate-800">최근 청구</p>
                        <p className="mt-1 text-xs text-slate-400">{detail.billing?.invoiceId || '발행된 청구서 없음'}</p>
                    </div>
                    {detail.billing ? <StatusBadge status={detail.billing.status} /> : <StatusBadge status="not_issued" />}
                </div>
                {detail.billing && (
                    <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                        <div><span className="text-slate-500">청구액</span><p className="font-medium">{currency(detail.billing.invoicedAmount)}</p></div>
                        <div><span className="text-slate-500">납부액</span><p className="font-medium">{currency(detail.billing.paidAmount)}</p></div>
                        <div><span className="text-slate-500">예상액</span><p className="font-medium">{currency(detail.billing.expectedAmount)}</p></div>
                    </div>
                )}
            </div>
            <div className="rounded-lg border bg-white">
                <div className="border-b px-4 py-3 text-sm font-medium">최근 납부</div>
                <div className="divide-y">
                    {detail.recentPayments.map((row) => (
                        <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                            <div>
                                <p className="font-medium text-slate-800">{currency(row.amount)}</p>
                                <p className="text-xs text-slate-400">{row.paymentDate} · {row.paymentMethod || '-'}</p>
                            </div>
                            <StatusBadge status={row.status} />
                        </div>
                    ))}
                    {detail.recentPayments.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">납부 기록이 없습니다.</p>}
                </div>
            </div>
        </div>
    );
}

interface StudentFormProps {
    mode: Exclude<FormMode, null>;
    classes: ClassSummary[];
    name: string;
    phone: string;
    parentPhone: string;
    grade: string;
    status: StudentStatus;
    billingMode: BillingMode;
    baseFee: string;
    hourlyRate: string;
    extraClassFee: string;
    selectedClassIds: Set<string>;
    submitting: boolean;
    onName: (value: string) => void;
    onPhone: (value: string) => void;
    onParentPhone: (value: string) => void;
    onGrade: (value: string) => void;
    onStatus: (value: StudentStatus) => void;
    onBillingMode: (value: BillingMode) => void;
    onBaseFee: (value: string) => void;
    onHourlyRate: (value: string) => void;
    onExtraClassFee: (value: string) => void;
    onToggleClass: (classId: string) => void;
    onCancel: () => void;
    onSubmit: (event: React.FormEvent) => void;
}

function StudentForm(props: StudentFormProps) {
    return (
        <form onSubmit={props.onSubmit} className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
                <div>
                    <Label>이름</Label>
                    <Input value={props.name} onChange={(event) => props.onName(event.target.value)} />
                </div>
                <div>
                    <Label>학년/메모</Label>
                    <Input value={props.grade} onChange={(event) => props.onGrade(event.target.value)} placeholder="중2" />
                </div>
                <div>
                    <Label>학생 연락처</Label>
                    <Input value={props.phone} onChange={(event) => props.onPhone(event.target.value)} />
                </div>
                <div>
                    <Label>보호자 연락처</Label>
                    <Input value={props.parentPhone} onChange={(event) => props.onParentPhone(event.target.value)} />
                </div>
            </div>

            {props.mode === 'edit' && (
                <div>
                    <Label>상태</Label>
                    <SelectBox value={props.status} onChange={(event) => props.onStatus(event.target.value as StudentStatus)}>
                        <option value="active">재원</option>
                        <option value="on_leave">휴원</option>
                        <option value="inactive">중지</option>
                        <option value="graduated">졸업</option>
                        <option value="dropped">퇴원/보관</option>
                    </SelectBox>
                </div>
            )}

            <div>
                <Label>반 배정</Label>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {props.classes.map((row) => (
                        <label key={row.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
                            <input type="checkbox" checked={props.selectedClassIds.has(row.id)} onChange={() => props.onToggleClass(row.id)} />
                            <span className="truncate">{row.name}</span>
                        </label>
                    ))}
                    {props.classes.length === 0 && <p className="text-sm text-slate-400">배정 가능한 반이 없습니다.</p>}
                </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
                <div>
                    <Label>청구 방식</Label>
                    <SelectBox value={props.billingMode} onChange={(event) => props.onBillingMode(event.target.value as BillingMode)}>
                        <option value="monthly_plus_classes">기본료 + 추가반</option>
                        <option value="usage_based">시간제</option>
                        <option value="manual">수동 청구</option>
                    </SelectBox>
                </div>
                <div>
                    <Label>기본료</Label>
                    <Input type="number" value={props.baseFee} onChange={(event) => props.onBaseFee(event.target.value)} />
                </div>
                <div>
                    <Label>시간제 금액</Label>
                    <Input type="number" value={props.hourlyRate} onChange={(event) => props.onHourlyRate(event.target.value)} />
                </div>
                <div>
                    <Label>추가반 금액</Label>
                    <Input type="number" value={props.extraClassFee} onChange={(event) => props.onExtraClassFee(event.target.value)} />
                </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="submit" disabled={props.submitting}>
                    {props.submitting ? '저장 중...' : props.mode === 'create' ? '학생 등록' : '수정 저장'}
                </Button>
                <Button type="button" variant="outline" onClick={props.onCancel} disabled={props.submitting}>
                    취소
                </Button>
            </div>
        </form>
    );
}

function ManagementTab({
    detail,
    classes,
    formMode,
    formProps,
    onStartEdit,
    onArchive,
    onHardDelete,
}: {
    detail: StudentDetail;
    classes: ClassSummary[];
    formMode: FormMode;
    formProps: Omit<StudentFormProps, 'mode' | 'classes'>;
    onStartEdit: () => void;
    onArchive: () => void;
    onHardDelete: () => void;
}) {
    const preview = detail.hardDeletePreview;
    return (
        <div className="grid gap-4">
            {detail.permissions.canEdit && (
                <div className="rounded-lg border bg-white p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                            <p className="text-sm font-medium text-slate-800">학생 정보 수정</p>
                            <p className="mt-1 text-xs text-slate-400">연락처, 반 배정, 청구 계약을 수정합니다.</p>
                        </div>
                        {formMode !== 'edit' && (
                            <Button type="button" variant="outline" size="sm" onClick={onStartEdit}>
                                <Pencil className="mr-2 h-4 w-4" />
                                수정
                            </Button>
                        )}
                    </div>
                    {formMode === 'edit' ? <StudentForm {...formProps} mode="edit" classes={classes} /> : <ProfileTab student={detail.summary} />}
                </div>
            )}

            {detail.permissions.canArchive && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
                                <ShieldAlert className="h-4 w-4" />
                                퇴원/보관
                            </p>
                            <p className="mt-1 text-sm text-amber-800">
                                운영 목록에서 숨기고 반 배정, 청구 계약, 학생 멤버십을 종료합니다. 회계, 출결, 학습, AI 이력은 보존됩니다.
                            </p>
                        </div>
                        <Button type="button" variant="outline" onClick={onArchive} disabled={detail.summary.status === 'dropped'}>
                            퇴원/보관 처리
                        </Button>
                    </div>
                </div>
            )}

            {detail.permissions.canHardDelete && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <p className="flex items-center gap-2 text-sm font-medium text-red-900">
                                <Trash2 className="h-4 w-4" />
                                오등록 완전삭제
                            </p>
                            <p className="mt-1 text-sm text-red-800">
                                청구, 납부, 출결, 학습, AI, 리포트 이력이 0건일 때만 삭제할 수 있습니다.
                            </p>
                            {preview && !preview.canHardDelete && (
                                <p className="mt-2 text-xs text-red-700">
                                    이력 {preview.historicalRecordCount}건 또는 공유 신원 {preview.sharedIdentityCount}건이 있어 완전삭제가 차단됩니다.
                                </p>
                            )}
                        </div>
                        <Button type="button" variant="destructive" onClick={onHardDelete} disabled={preview ? !preview.canHardDelete : false}>
                            완전삭제
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

export function StudentsOperationsPage() {
    const { profile } = useAuth();
    const academyId = academyIdOf(profile?.current_academy_id);
    const [students, setStudents] = useState<StudentSummary[]>([]);
    const [classes, setClasses] = useState<ClassSummary[]>([]);
    const [permissions, setPermissions] = useState<StudentOperationsPermissions>(emptyPermissions);
    const [loading, setLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(false);
    const [metricsLoading, setMetricsLoading] = useState(false);
    const [sectionLoading, setSectionLoading] = useState<Partial<Record<StudentDetailSection, boolean>>>({});
    const [error, setError] = useState('');
    const [selectedStudentId, setSelectedStudentId] = useState('');
    const [detail, setDetail] = useState<StudentDetail | null>(null);
    const [activeTab, setActiveTab] = useState('learning');
    const [searchQuery, setSearchQuery] = useState('');
    const [classFilter, setClassFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState<StudentFilterStatus>('operations');
    const [sortMode, setSortMode] = useState<StudentSortMode>('risk');
    const [formMode, setFormMode] = useState<FormMode>(null);
    const [submitting, setSubmitting] = useState(false);
    const [archiveOpen, setArchiveOpen] = useState(false);
    const [hardDeleteOpen, setHardDeleteOpen] = useState(false);
    const [hardDeletePreview, setHardDeletePreview] = useState<StudentHardDeletePreview | null>(null);
    const [hardDeleteConfirmName, setHardDeleteConfirmName] = useState('');
    const [hardDeletePasswordOpen, setHardDeletePasswordOpen] = useState(false);

    const [editingStudentId, setEditingStudentId] = useState('');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [parentPhone, setParentPhone] = useState('');
    const [grade, setGrade] = useState('');
    const [studentStatus, setStudentStatus] = useState<StudentStatus>('active');
    const [billingMode, setBillingMode] = useState<BillingMode>('monthly_plus_classes');
    const [baseFee, setBaseFee] = useState('0');
    const [hourlyRate, setHourlyRate] = useState('');
    const [extraClassFee, setExtraClassFee] = useState('0');
    const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set());

    const resetStudentForm = useCallback(() => {
        setEditingStudentId('');
        setName('');
        setPhone('');
        setParentPhone('');
        setGrade('');
        setStudentStatus('active');
        setBillingMode('monthly_plus_classes');
        setBaseFee('0');
        setHourlyRate('');
        setExtraClassFee('0');
        setSelectedClassIds(new Set());
        setFormMode(null);
    }, []);

    const mergeLearningMetrics = useCallback((metrics: StudentLearningMetric[]) => {
        if (metrics.length === 0) return;
        const metricsByStudent = new Map(metrics.map((row) => [row.studentId, row]));
        setStudents((current) => current.map((student) => {
            const metric = metricsByStudent.get(student.id);
            if (!metric) return student;
            return {
                ...student,
                weakTypeCount: metric.weakTypeCount,
                avgTypeScore: metric.avgTypeScore,
                lastLearningAt: metric.lastLearningAt,
                learningMetricsLoaded: true,
            };
        }));
    }, []);

    const loadMetrics = useCallback(async (studentIds: string[]) => {
        if (!academyId || studentIds.length === 0) return;
        setMetricsLoading(true);
        try {
            const metrics = await loadStudentLearningMetrics(academyId, studentIds);
            mergeLearningMetrics(metrics);
        } catch (err) {
            console.warn('[Students] Failed to load learning metrics:', err);
        } finally {
            setMetricsLoading(false);
        }
    }, [academyId, mergeLearningMetrics]);

    const load = useCallback(async () => {
        if (!academyId) return;
        setLoading(true);
        setError('');
        try {
            const data = await loadStudentOperationsOverview(academyId);
            setStudents(data.students);
            setClasses(data.classes);
            setPermissions(data.permissions);
            setSelectedStudentId((current) => {
                if (current && data.students.some((student) => student.id === current)) return current;
                return '';
            });
            void loadMetrics(data.students.map((student) => student.id));
        } catch (err) {
            const message = err instanceof Error ? err.message : '학생 정보를 불러오지 못했습니다.';
            setError(message);
            toast.error(message);
        } finally {
            setLoading(false);
        }
    }, [academyId, loadMetrics]);

    const loadDetail = useCallback(async (
        studentId: string,
        section: StudentDetailSection = 'learning',
        options: { replace?: boolean } = {},
    ) => {
        if (!academyId || !studentId) {
            setDetail(null);
            return;
        }
        if (options.replace) setDetailLoading(true);
        else setSectionLoading((current) => ({ ...current, [section]: true }));
        try {
            const data = await loadStudentDetail(academyId, studentId, section);
            setDetail((current) => options.replace ? data : mergeStudentDetail(current, data));
            if (data.hardDeletePreview) setHardDeletePreview(data.hardDeletePreview);
        } catch (err) {
            const message = err instanceof Error ? err.message : '학생 상세 정보를 불러오지 못했습니다.';
            toast.error(message);
            if (options.replace) setDetail(null);
        } finally {
            if (options.replace) setDetailLoading(false);
            else setSectionLoading((current) => ({ ...current, [section]: false }));
        }
    }, [academyId]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        if (!selectedStudentId) {
            setDetail(null);
            setHardDeletePreview(null);
            return;
        }
        setActiveTab('learning');
        setSectionLoading({});
        setHardDeletePreview(null);
        resetStudentForm();
        void loadDetail(selectedStudentId, 'learning', { replace: true });
    }, [loadDetail, resetStudentForm, selectedStudentId]);

    const handleTabChange = useCallback((tab: string) => {
        setActiveTab(tab);
        const section = DETAIL_SECTION_BY_TAB[tab];
        if (!section || section === 'management' || !selectedStudentId || hasLoadedSection(detail, section)) return;
        void loadDetail(selectedStudentId, section);
    }, [detail, loadDetail, selectedStudentId]);

    const filteredStudents = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        const filtered = students.filter((student) => {
            const matchesQuery = !query
                || student.name.toLowerCase().includes(query)
                || (student.phone || '').includes(query)
                || (student.parentPhone || '').includes(query);
            const matchesClass = classFilter === 'all' || student.classIds.includes(classFilter);
            const matchesStatus = statusFilter === 'all'
                ? true
                : statusFilter === 'operations'
                    ? student.status !== 'dropped'
                    : student.status === statusFilter;
            return matchesQuery && matchesClass && matchesStatus;
        });
        return sortStudents(filtered, sortMode);
    }, [classFilter, searchQuery, sortMode, statusFilter, students]);

    const selectedStudent = useMemo(
        () => students.find((student) => student.id === selectedStudentId) || null,
        [selectedStudentId, students],
    );

    if (!academyId) {
        return (
            <div className="mx-auto flex h-full max-w-xl items-center justify-center p-8">
                <Card>
                    <CardHeader><CardTitle>학원 연결이 필요합니다.</CardTitle></CardHeader>
                    <CardContent className="text-sm text-slate-500">현재 계정에 연결된 academy가 없습니다.</CardContent>
                </Card>
            </div>
        );
    }

    const startCreate = () => {
        setSelectedStudentId('');
        setDetail(null);
        resetStudentForm();
        setFormMode('create');
        setActiveTab('manage');
    };

    const startEdit = () => {
        const student = detail?.summary || selectedStudent;
        if (!student) return;
        setEditingStudentId(student.id);
        setName(student.name);
        setPhone(student.phone || '');
        setParentPhone(student.parentPhone || '');
        setGrade(student.grade || '');
        setStudentStatus(student.status);
        setBillingMode(student.billingMode || 'monthly_plus_classes');
        setBaseFee(String(student.baseMonthlyFee || 0));
        setHourlyRate(student.hourlyRate === null ? '' : String(student.hourlyRate));
        setExtraClassFee(String(student.extraClassFee || 0));
        setSelectedClassIds(new Set(student.classIds));
        setFormMode('edit');
    };

    const toggleClass = (classId: string) => {
        setSelectedClassIds((prev) => {
            const next = new Set(prev);
            if (next.has(classId)) next.delete(classId);
            else next.add(classId);
            return next;
        });
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!academyId || !permissions.canEdit && formMode === 'edit' || !permissions.canCreate && formMode === 'create') return;

        const classIds = [...selectedClassIds];
        const classBillingRules = classIds.map((classId, index) => {
            if (billingMode === 'usage_based') {
                return { classId, ruleType: 'usage_based' as const, amount: Number(hourlyRate) || 0 };
            }
            return {
                classId,
                ruleType: index === 0 || billingMode === 'manual' ? 'included' as const : 'extra_flat' as const,
                amount: index === 0 || billingMode === 'manual' ? 0 : Number(extraClassFee) || 0,
            };
        });

        setSubmitting(true);
        try {
            const payload = {
                name,
                phone,
                parentPhone,
                grade,
                classIds,
                classBillingRules,
                billingMode,
                baseMonthlyFee: Number(baseFee) || 0,
                hourlyRate: hourlyRate ? Number(hourlyRate) : null,
            };
            if (editingStudentId) {
                await updateStudent(academyId, editingStudentId, { ...payload, status: studentStatus });
                toast.success('학생 정보를 수정했습니다.');
                setSelectedStudentId(editingStudentId);
            } else {
                await createStudent(academyId, payload);
                toast.success('학생을 등록했습니다.');
            }
            resetStudentForm();
            await load();
            if (editingStudentId) await loadDetail(editingStudentId, 'learning', { replace: true });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '학생 저장에 실패했습니다.');
        } finally {
            setSubmitting(false);
        }
    };

    const executeArchive = async () => {
        if (!academyId || !selectedStudentId) return;
        try {
            await archiveStudent(academyId, selectedStudentId);
            toast.success('학생을 퇴원/보관 처리했습니다.');
            setArchiveOpen(false);
            resetStudentForm();
            await load();
            setSelectedStudentId('');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '퇴원/보관 처리에 실패했습니다.');
        }
    };

    const openHardDelete = async () => {
        if (!academyId || !selectedStudentId) return;
        setHardDeleteOpen(true);
        setHardDeleteConfirmName('');
        setHardDeletePreview(null);
        try {
            const preview = await previewHardDeleteStudent(academyId, selectedStudentId);
            setHardDeletePreview(preview);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '완전삭제 가능 여부를 확인하지 못했습니다.');
        }
    };

    const executeHardDelete = async () => {
        if (!academyId || !selectedStudentId) return;
        try {
            await hardDeleteStudent(academyId, selectedStudentId, hardDeleteConfirmName);
            toast.success('오등록 학생을 완전삭제했습니다.');
            setHardDeletePasswordOpen(false);
            setHardDeleteOpen(false);
            setSelectedStudentId('');
            setDetail(null);
            await load();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '완전삭제에 실패했습니다.');
        }
    };

    const formProps = {
        name,
        phone,
        parentPhone,
        grade,
        status: studentStatus,
        billingMode,
        baseFee,
        hourlyRate,
        extraClassFee,
        selectedClassIds,
        submitting,
        onName: setName,
        onPhone: setPhone,
        onParentPhone: setParentPhone,
        onGrade: setGrade,
        onStatus: setStudentStatus,
        onBillingMode: setBillingMode,
        onBaseFee: setBaseFee,
        onHourlyRate: setHourlyRate,
        onExtraClassFee: setExtraClassFee,
        onToggleClass: toggleClass,
        onCancel: resetStudentForm,
        onSubmit: submit,
    };

    return (
        <PageShell
            action={permissions.canCreate ? (
                <Button type="button" onClick={startCreate}>
                    <Plus className="mr-2 h-4 w-4" />
                    학생 등록
                </Button>
            ) : undefined}
        >
            {loading && <SkeletonPage />}
            {!loading && error && (
                <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-lg border border-red-200 bg-red-50 p-6 text-center">
                    <AlertTriangle className="h-7 w-7 text-red-600" />
                    <p className="text-sm font-medium text-red-800">{error}</p>
                    <Button variant="outline" onClick={() => void load()}>다시 시도</Button>
                </div>
            )}
            {!loading && !error && (
                <div className="grid min-h-[620px] gap-5 xl:grid-cols-[0.9fr_1.5fr]">
                    <Card className="overflow-hidden">
                        <CardHeader className="space-y-4">
                            <div className="flex items-center justify-between gap-3">
                                <CardTitle>학생 목록</CardTitle>
                                {permissions.scopedToAssignedClasses && (
                                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">담당 반만</span>
                                )}
                            </div>
                            <div className="grid gap-2">
                                <div className="relative">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                    <Input className="pl-9" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="이름, 학생/보호자 연락처 검색" />
                                </div>
                                <div className="grid gap-2 sm:grid-cols-3">
                                    <SelectBox value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
                                        <option value="all">전체 반</option>
                                        {classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                                    </SelectBox>
                                    <SelectBox value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StudentFilterStatus)}>
                                        <option value="operations">운영 학생</option>
                                        <option value="all">전체 상태</option>
                                        <option value="active">재원</option>
                                        <option value="on_leave">휴원</option>
                                        <option value="inactive">중지</option>
                                        <option value="graduated">졸업</option>
                                        <option value="dropped">퇴원/보관</option>
                                    </SelectBox>
                                    <SelectBox value={sortMode} onChange={(event) => setSortMode(event.target.value as StudentSortMode)}>
                                        <option value="risk">위험도순</option>
                                        <option value="recent">최근 학습순</option>
                                        <option value="name">이름순</option>
                                    </SelectBox>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <StudentList
                                students={filteredStudents}
                                selectedStudentId={selectedStudentId}
                                metricsLoading={metricsLoading}
                                onSelect={(student) => setSelectedStudentId(student.id)}
                            />
                        </CardContent>
                    </Card>

                    {formMode === 'create' && permissions.canCreate ? (
                        <Card>
                            <CardHeader><CardTitle>학생 등록</CardTitle></CardHeader>
                            <CardContent>
                                <StudentForm {...formProps} mode="create" classes={classes} />
                            </CardContent>
                        </Card>
                    ) : detailLoading ? (
                        <StudentDetailSkeleton />
                    ) : detail ? (
                        <Card className="overflow-hidden">
                            <CardHeader className="border-b">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <CardTitle>{detail.summary.name}</CardTitle>
                                            <StatusBadge status={detail.summary.status} />
                                        </div>
                                        <p className="mt-1 text-sm text-slate-500">
                                            {detail.summary.classNames.join(', ') || '배정 반 없음'} · {detail.summary.phone || '학생 연락처 없음'} · 보호자 {detail.summary.parentPhone || '-'}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <div className="rounded-lg bg-slate-50 px-3 py-2 text-right text-xs">
                                            <p className="text-slate-500">취약/주의</p>
                                            <p className="font-semibold text-slate-950">{detail.summary.weakTypeCount || 0}개</p>
                                        </div>
                                        <div className="rounded-lg bg-slate-50 px-3 py-2 text-right text-xs">
                                            <p className="text-slate-500">최근 학습</p>
                                            <p className="font-semibold text-slate-950">{shortDate(detail.summary.lastLearningAt)}</p>
                                        </div>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="p-4">
                                <Tabs value={activeTab} onValueChange={handleTabChange} variant="underline">
                                    <TabsList className="flex h-auto w-full flex-wrap justify-start overflow-x-auto">
                                        <TabsTrigger value="learning"><BarChart3 className="mr-2 h-4 w-4" />학습분석</TabsTrigger>
                                        <TabsTrigger value="profile"><UserRound className="mr-2 h-4 w-4" />프로필</TabsTrigger>
                                        <TabsTrigger value="attendance"><CalendarDays className="mr-2 h-4 w-4" />출결</TabsTrigger>
                                        {detail.permissions.canViewBilling && <TabsTrigger value="billing"><CreditCard className="mr-2 h-4 w-4" />청구</TabsTrigger>}
                                        {(detail.permissions.canEdit || detail.permissions.canArchive || detail.permissions.canHardDelete) && (
                                            <TabsTrigger value="manage"><ShieldAlert className="mr-2 h-4 w-4" />관리</TabsTrigger>
                                        )}
                                    </TabsList>
                                    <TabsContent value="learning">{sectionLoading.learning ? <StudentTabSkeleton /> : <LearningTab detail={detail} />}</TabsContent>
                                    <TabsContent value="profile"><ProfileTab student={detail.summary} /></TabsContent>
                                    <TabsContent value="attendance">{sectionLoading.attendance ? <StudentTabSkeleton /> : <AttendanceTab detail={detail} />}</TabsContent>
                                    {detail.permissions.canViewBilling && (
                                        <TabsContent value="billing">
                                            {sectionLoading.billing ? <StudentTabSkeleton /> : <BillingTab detail={detail} />}
                                        </TabsContent>
                                    )}
                                    {(detail.permissions.canEdit || detail.permissions.canArchive || detail.permissions.canHardDelete) && (
                                        <TabsContent value="manage">
                                            <ManagementTab
                                                detail={detail}
                                                classes={classes}
                                                formMode={formMode}
                                                formProps={formProps}
                                                onStartEdit={startEdit}
                                                onArchive={() => setArchiveOpen(true)}
                                                onHardDelete={openHardDelete}
                                            />
                                        </TabsContent>
                                    )}
                                </Tabs>
                            </CardContent>
                        </Card>
                    ) : (
                        <EmptyDetail canCreate={permissions.canCreate} onCreate={startCreate} />
                    )}
                </div>
            )}

            <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>퇴원/보관 처리</DialogTitle>
                        <DialogDescription>
                            {detail?.summary.name || selectedStudent?.name} 학생을 운영 목록에서 숨기고 반 배정, 청구 계약, 학생 멤버십을 종료합니다. 회계, 출결, 학습, AI 이력은 유지됩니다.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setArchiveOpen(false)}>취소</Button>
                        <Button type="button" variant="destructive" onClick={() => void executeArchive()}>퇴원/보관 처리</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={hardDeleteOpen} onOpenChange={setHardDeleteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>오등록 완전삭제</DialogTitle>
                        <DialogDescription>
                            이 기능은 이력이 없는 오등록 학생만 삭제합니다. 이력이 있는 학생은 퇴원/보관만 가능합니다.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                            <p className="font-medium text-slate-800">{hardDeletePreview?.studentName || detail?.summary.name || '-'}</p>
                            {hardDeletePreview ? (
                                <div className="mt-2 grid gap-1 text-xs text-slate-600">
                                    {hardDeletePreview.blockers.filter((row) => row.count > 0).map((row) => (
                                        <div key={row.key} className="flex justify-between gap-3">
                                            <span>{row.label}</span>
                                            <strong>{row.count.toLocaleString()}건</strong>
                                        </div>
                                    ))}
                                    {hardDeletePreview.canHardDelete && <p className="text-emerald-700">차단 이력이 없어 완전삭제할 수 있습니다.</p>}
                                    {!hardDeletePreview.canHardDelete && <p className="text-red-700">이력이 있어 완전삭제가 차단됩니다.</p>}
                                </div>
                            ) : (
                                <p className="mt-2 text-xs text-slate-500">가능 여부를 확인하는 중입니다.</p>
                            )}
                        </div>
                        <div>
                            <Label>학생 이름 확인</Label>
                            <Input value={hardDeleteConfirmName} onChange={(event) => setHardDeleteConfirmName(event.target.value)} placeholder={hardDeletePreview?.studentName || detail?.summary.name || ''} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setHardDeleteOpen(false)}>취소</Button>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={!hardDeletePreview?.canHardDelete || hardDeleteConfirmName.trim() !== hardDeletePreview.studentName}
                            onClick={() => setHardDeletePasswordOpen(true)}
                        >
                            비밀번호 확인
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <PasswordConfirmDialog
                open={hardDeletePasswordOpen}
                onOpenChange={setHardDeletePasswordOpen}
                title="완전삭제 확인"
                description="오등록 학생과 연결된 임시 데이터가 삭제됩니다. 과거 이력이 있는 학생은 서버에서 다시 차단됩니다."
                confirmLabel="완전삭제"
                onConfirm={executeHardDelete}
            />
        </PageShell>
    );
}
