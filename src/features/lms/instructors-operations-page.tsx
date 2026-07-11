'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
    CalendarDays,
    CreditCard,
    KeyRound,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    ShieldAlert,
    UserRound,
    Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { PasswordConfirmDialog } from '@/components/security/PasswordConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    DataTable,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/data-table';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { FormField, FormSection } from '@/components/ui/form';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { Input } from '@/components/ui/input';
import { PageShell, PageStatusBar } from '@/components/ui/page-shell';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SelectableCard } from '@/components/ui/selectable-card';
import { Skeleton, SkeletonPage, SkeletonPanel } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import {
    addLmsInvalidationListener,
    archiveStaff,
    createInstructorPayment,
    createStaff,
    hardDeleteStaff,
    loadStaffDetail,
    loadStaffOperationsOverview,
    previewHardDeleteStaff,
    updateStaff,
} from './service';
import { LessonSpecialStatusBadge } from './classrooms/lesson-special-status-badge';
import { LatestAbortController } from './latest-abort-controller';
import { useDebouncedValue } from './use-debounced-value';
import type {
    ClassSummary,
    CreateInstructorPaymentInput,
    ScheduleItem,
    StaffDetail,
    StaffHardDeletePreview,
    StaffOperationsPermissions,
    StaffRole,
    StaffStatus,
    StaffSummary,
    WithholdingType,
} from './types';

type StaffFilterStatus = 'operations' | 'all' | StaffStatus;
type StaffRoleFilter = 'all' | StaffRole;
type StaffSortMode = 'name' | 'classes' | 'recentPayment';
type FormMode = 'create' | 'edit' | null;

const emptyPermissions: StaffOperationsPermissions = {
    canCreate: false,
    canEdit: false,
    canArchive: false,
    canHardDelete: false,
    canViewPayroll: false,
    canCreatePayroll: false,
    canViewAccount: false,
    canViewSensitiveProfile: false,
    scopedToPeerClasses: false,
};

function academyIdOf(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function today(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function currentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function currency(value: number | null | undefined): string {
    return `${Math.round(value || 0).toLocaleString()}원`;
}

function shortDate(value: string | null | undefined): string {
    return value ? value.slice(0, 10) : '-';
}

function roleLabel(role: StaffRole | 'owner' | null | undefined): string {
    switch (role) {
        case 'owner':
            return '소유자';
        case 'admin':
            return '관리자';
        case 'staff':
            return '직원';
        case 'teacher':
            return '교사';
        case 'instructor':
            return '강사';
        default:
            return '-';
    }
}

function statusLabel(status: StaffStatus | string | null | undefined): string {
    if (status === 'active') return '재직';
    if (status === 'on_leave') return '휴직';
    if (status === 'inactive') return '퇴사/비활성';
    return status || '-';
}

function sortStaff(staff: StaffSummary[], sortMode: StaffSortMode): StaffSummary[] {
    return [...staff].sort((a, b) => {
        if (sortMode === 'classes') {
            return (b.activeClassCount || 0) - (a.activeClassCount || 0) || a.name.localeCompare(b.name, 'ko');
        }
        if (sortMode === 'recentPayment') {
            return String(b.lastPaymentDate || '').localeCompare(String(a.lastPaymentDate || '')) || a.name.localeCompare(b.name, 'ko');
        }
        return a.name.localeCompare(b.name, 'ko');
    });
}

function roleTone(role: StaffRole | 'owner'): 'neutral' | 'primary' | 'info' {
    if (role === 'admin' || role === 'owner') return 'primary';
    if (role === 'staff') return 'info';
    return 'neutral';
}

function StaffList({
    staff,
    selectedStaffId,
    onSelect,
}: {
    staff: StaffSummary[];
    selectedStaffId: string;
    onSelect: (row: StaffSummary) => void;
}) {
    return (
        <div className="space-y-2 bg-card p-2">
            {staff.map((row) => (
                <SelectableCard
                    key={row.id}
                    selected={selectedStaffId === row.id}
                    className="flex items-start justify-between gap-3"
                    onClick={() => onSelect(row)}
                >
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-medium text-foreground">{row.name}</span>
                            <StatusBadge status={row.status} label={statusLabel(row.status)} />
                            <StatusBadge status={row.role} label={roleLabel(row.role)} tone={roleTone(row.role)} />
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                            {(row.classNames || []).join(', ') || '담당 반 없음'}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground/80">
                            {row.visibleToPeerOnly ? '공유 반 기준 기본정보' : `${row.phone || '-'} · ${row.email || '-'}`}
                        </p>
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                        <p className="font-medium text-foreground">{row.activeClassCount || 0}개 반</p>
                        <p className="mt-1">{row.upcomingLessonCount || 0}개 시간표</p>
                    </div>
                </SelectableCard>
            ))}
            {staff.length === 0 && (
                <EmptyState title="조건에 맞는 강사/직원이 없습니다." className="border-0" />
            )}
        </div>
    );
}

function StaffDetailSkeleton() {
    return <SkeletonPanel rows={8} />;
}

function StaffForm({
    mode,
    submitting,
    name,
    phone,
    email,
    role,
    status,
    hourlyRate,
    hireDate,
    qualifications,
    notes,
    onName,
    onPhone,
    onEmail,
    onRole,
    onStatus,
    onHourlyRate,
    onHireDate,
    onQualifications,
    onNotes,
    onCancel,
    onSubmit,
}: {
    mode: 'create' | 'edit';
    submitting: boolean;
    name: string;
    phone: string;
    email: string;
    role: StaffRole;
    status: StaffStatus;
    hourlyRate: string;
    hireDate: string;
    qualifications: string;
    notes: string;
    onName: (value: string) => void;
    onPhone: (value: string) => void;
    onEmail: (value: string) => void;
    onRole: (value: StaffRole) => void;
    onStatus: (value: StaffStatus) => void;
    onHourlyRate: (value: string) => void;
    onHireDate: (value: string) => void;
    onQualifications: (value: string) => void;
    onNotes: (value: string) => void;
    onCancel: () => void;
    onSubmit: (event: React.FormEvent) => void;
}) {
    return (
        <form onSubmit={onSubmit} className="space-y-4">
            <FormSection title={mode === 'create' ? '강사/직원 등록' : '강사/직원 수정'}>
                <div className="grid gap-3 md:grid-cols-2">
                    <FormField label="이름">
                        <Input value={name} onChange={(event) => onName(event.target.value)} disabled={submitting} />
                    </FormField>
                    <FormField label="역할">
                        <Select value={role} onValueChange={(value) => onRole(value as StaffRole)} disabled={submitting}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="instructor">강사</SelectItem>
                                <SelectItem value="teacher">교사</SelectItem>
                                <SelectItem value="staff">직원</SelectItem>
                                <SelectItem value="admin">관리자</SelectItem>
                            </SelectContent>
                        </Select>
                    </FormField>
                    {mode === 'edit' && (
                        <FormField label="상태">
                            <Select value={status} onValueChange={(value) => onStatus(value as StaffStatus)} disabled={submitting}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="active">재직</SelectItem>
                                    <SelectItem value="on_leave">휴직</SelectItem>
                                    <SelectItem value="inactive">퇴사/비활성</SelectItem>
                                </SelectContent>
                            </Select>
                        </FormField>
                    )}
                    <FormField label="연락처">
                        <Input value={phone} onChange={(event) => onPhone(event.target.value)} disabled={submitting} />
                    </FormField>
                    <FormField label="이메일">
                        <Input type="email" value={email} onChange={(event) => onEmail(event.target.value)} disabled={submitting} />
                    </FormField>
                    <FormField label="시급">
                        <Input type="number" min="0" value={hourlyRate} onChange={(event) => onHourlyRate(event.target.value)} disabled={submitting} />
                    </FormField>
                    <FormField label="입사일">
                        <Input type="date" value={hireDate} onChange={(event) => onHireDate(event.target.value)} disabled={submitting} />
                    </FormField>
                </div>
                <FormField label="자격/전문분야">
                    <Input value={qualifications} onChange={(event) => onQualifications(event.target.value)} disabled={submitting} />
                </FormField>
                <FormField label="메모">
                    <Textarea value={notes} onChange={(event) => onNotes(event.target.value)} disabled={submitting} />
                </FormField>
                <div className="grid gap-2 sm:grid-cols-2">
                    <Button type="submit" disabled={submitting || !name.trim()}>
                        {submitting ? '저장 중' : mode === 'create' ? '등록' : '수정 저장'}
                    </Button>
                    <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
                        취소
                    </Button>
                </div>
            </FormSection>
        </form>
    );
}

function OverviewTab({ detail }: { detail: StaffDetail }) {
    const staff = detail.summary;
    return (
        <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-muted p-4">
                    <p className="text-xs text-muted-foreground">담당 반</p>
                    <p className="mt-1 text-xl font-semibold">{staff.activeClassCount || 0}개</p>
                </div>
                <div className="rounded-xl bg-muted p-4">
                    <p className="text-xs text-muted-foreground">반복 시간표</p>
                    <p className="mt-1 text-xl font-semibold">{staff.upcomingLessonCount || 0}개</p>
                </div>
                <div className="rounded-xl bg-muted p-4">
                    <p className="text-xs text-muted-foreground">최근 지급</p>
                    <p className="mt-1 text-xl font-semibold">{shortDate(staff.lastPaymentDate)}</p>
                </div>
            </div>
            <div className="rounded-xl border bg-card p-4">
                <p className="text-sm font-medium">담당 반</p>
                <div className="mt-3 flex flex-wrap gap-2">
                    {(staff.classNames || []).map((name) => (
                        <StatusBadge key={name} label={name} tone="neutral" />
                    ))}
                    {(!staff.classNames || staff.classNames.length === 0) && (
                        <p className="text-sm text-muted-foreground">기본 담당 반이 없습니다.</p>
                    )}
                </div>
            </div>
        </div>
    );
}

function ProfileTab({ detail }: { detail: StaffDetail }) {
    const staff = detail.summary;
    if (!detail.permissions.canViewSensitiveProfile) {
        return (
            <EmptyState
                icon={UserRound}
                title="기본정보만 표시됩니다."
                description="공유 반 동료에게는 연락처, 이메일, 급여, 계정 정보가 노출되지 않습니다."
            />
        );
    }

    return (
        <div className="grid gap-3 md:grid-cols-2">
            <InfoItem label="이름" value={staff.name} />
            <InfoItem label="역할" value={roleLabel(staff.role)} />
            <InfoItem label="상태" value={statusLabel(staff.status)} />
            <InfoItem label="연락처" value={staff.phone || '-'} />
            <InfoItem label="이메일" value={staff.email || '-'} />
            <InfoItem label="시급" value={staff.hourlyRate ? `${currency(staff.hourlyRate)} / 시간` : '-'} />
            <InfoItem label="입사일" value={shortDate(staff.hireDate)} />
            <InfoItem label="자격/전문분야" value={staff.qualifications || '-'} />
            <div className="md:col-span-2">
                <InfoItem label="메모" value={staff.notes || '-'} />
            </div>
        </div>
    );
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
        </div>
    );
}

function ClassesTab({ classes, schedule }: { classes: ClassSummary[]; schedule: ScheduleItem[] }) {
    return (
        <div className="space-y-4">
            <div className="rounded-xl border bg-card p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p className="text-sm font-medium">담당 반</p>
                        <p className="mt-1 text-xs text-muted-foreground">이 화면에서는 조회만 가능합니다. 담당 강사 변경은 반/시간표 메뉴에서 처리합니다.</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" asChild>
                        <Link href="/classrooms">반/시간표로 이동</Link>
                    </Button>
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-2">
                    {classes.map((row) => (
                        <div key={row.id} className="rounded-lg bg-muted p-3 text-sm">
                            <div className="flex items-center justify-between gap-2">
                                <strong>{row.name}</strong>
                                <StatusBadge status={row.status} />
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                                {row.grade || '-'} · 학생 {row.studentCount}명 · {row.classroomName || '강의실 미지정'}
                            </p>
                        </div>
                    ))}
                    {classes.length === 0 && <p className="text-sm text-muted-foreground">담당 반이 없습니다.</p>}
                </div>
            </div>

            <DataTable>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>일자/기준일</TableHead>
                            <TableHead>시간</TableHead>
                            <TableHead>반</TableHead>
                            <TableHead>강의실</TableHead>
                            <TableHead>특이사항</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {schedule.map((row) => (
                            <TableRow key={row.id}>
                                <TableCell>{row.date}</TableCell>
                                <TableCell>{row.startTime} - {row.endTime}</TableCell>
                                <TableCell className="font-medium">{row.className}</TableCell>
                                <TableCell className="text-muted-foreground">{row.classroomName || '-'}</TableCell>
                                <TableCell><LessonSpecialStatusBadge status={row.status} /></TableCell>
                            </TableRow>
                        ))}
                        {schedule.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">표시할 시간표가 없습니다.</TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </DataTable>
        </div>
    );
}

function PayrollTab({
    detail,
    serviceMonth,
    onServiceMonth,
    onSubmitPayment,
    paymentState,
}: {
    detail: StaffDetail;
    serviceMonth: string;
    onServiceMonth: (value: string) => void;
    onSubmitPayment: (event: React.FormEvent) => void;
    paymentState: {
        paymentDate: string;
        grossAmount: string;
        hoursWorked: string;
        hourlyRate: string;
        withholdingType: WithholdingType;
        paymentMethod: string;
        recipientName: string;
        notes: string;
        submitting: boolean;
        setPaymentDate: (value: string) => void;
        setGrossAmount: (value: string) => void;
        setHoursWorked: (value: string) => void;
        setHourlyRate: (value: string) => void;
        setWithholdingType: (value: WithholdingType) => void;
        setPaymentMethod: (value: string) => void;
        setRecipientName: (value: string) => void;
        setNotes: (value: string) => void;
    };
}) {
    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <p className="text-sm font-medium">급여 지급</p>
                    <p className="mt-1 text-xs text-muted-foreground">수령자명은 지급 시점 이름 스냅샷으로 저장됩니다.</p>
                </div>
                <Input type="month" value={serviceMonth} onChange={(event) => onServiceMonth(event.target.value)} className="w-full sm:w-40" />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
                <InfoItem label="총 지급액" value={currency(detail.payrollSummary?.grossAmount || 0)} />
                <InfoItem label="실지급액" value={currency(detail.payrollSummary?.netAmount || 0)} />
                <InfoItem label="지급 건수" value={`${detail.payrollSummary?.paidCount || 0}건`} />
            </div>
            {detail.permissions.canCreatePayroll && (
                <form onSubmit={onSubmitPayment}>
                    <FormSection title="지급 등록">
                        <div className="grid gap-3 md:grid-cols-3">
                            <FormField label="수령자명">
                                <Input value={paymentState.recipientName} onChange={(event) => paymentState.setRecipientName(event.target.value)} placeholder={detail.summary.name} />
                            </FormField>
                            <FormField label="지급일">
                                <Input type="date" value={paymentState.paymentDate} onChange={(event) => paymentState.setPaymentDate(event.target.value)} />
                            </FormField>
                            <FormField label="총액">
                                <Input type="number" min="0" value={paymentState.grossAmount} onChange={(event) => paymentState.setGrossAmount(event.target.value)} />
                            </FormField>
                            <FormField label="시간">
                                <Input type="number" min="0" value={paymentState.hoursWorked} onChange={(event) => paymentState.setHoursWorked(event.target.value)} />
                            </FormField>
                            <FormField label="시급">
                                <Input type="number" min="0" value={paymentState.hourlyRate} onChange={(event) => paymentState.setHourlyRate(event.target.value)} />
                            </FormField>
                            <FormField label="원천징수">
                                <Select value={paymentState.withholdingType} onValueChange={(value) => paymentState.setWithholdingType(value as WithholdingType)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="freelance_3.3">프리랜서 3.3%</SelectItem>
                                        <SelectItem value="none">없음</SelectItem>
                                        <SelectItem value="custom">직접 계산</SelectItem>
                                    </SelectContent>
                                </Select>
                            </FormField>
                            <FormField label="지급수단">
                                <Input value={paymentState.paymentMethod} onChange={(event) => paymentState.setPaymentMethod(event.target.value)} />
                            </FormField>
                            <FormField label="메모" className="md:col-span-2">
                                <Input value={paymentState.notes} onChange={(event) => paymentState.setNotes(event.target.value)} />
                            </FormField>
                        </div>
                        <Button type="submit" disabled={paymentState.submitting || !paymentState.grossAmount}>
                            {paymentState.submitting ? '저장 중' : '지급 저장'}
                        </Button>
                    </FormSection>
                </form>
            )}
            <DataTable>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>지급일</TableHead>
                            <TableHead>수령자</TableHead>
                            <TableHead>총액</TableHead>
                            <TableHead>실지급</TableHead>
                            <TableHead>상태</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {detail.payroll.map((row) => (
                            <TableRow key={row.id}>
                                <TableCell>{row.paymentDate}</TableCell>
                                <TableCell className="font-medium">{row.recipientName || row.instructorName || '-'}</TableCell>
                                <TableCell>{currency(row.grossAmount)}</TableCell>
                                <TableCell>{currency(row.netAmount)}</TableCell>
                                <TableCell><StatusBadge status={row.status} /></TableCell>
                            </TableRow>
                        ))}
                        {detail.payroll.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">해당 월 지급 기록이 없습니다.</TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </DataTable>
        </div>
    );
}

function AccountTab({ detail }: { detail: StaffDetail }) {
    const account = detail.account;
    if (!account) {
        return <EmptyState icon={KeyRound} title="계정 상태를 볼 수 없습니다." />;
    }
    return (
        <div className="grid gap-3 md:grid-cols-2">
            <InfoItem label="로그인 계정" value={account.hasAccount ? '연결됨' : '없음'} />
            <InfoItem label="계정 상태" value={account.accountStatus || '-'} />
            <InfoItem label="멤버십 역할" value={roleLabel(account.membershipRole)} />
            <InfoItem label="멤버십 활성" value={account.membershipActive ? '활성' : '비활성'} />
            <InfoItem label="대기 초대" value={account.pendingInvitation ? `만료 ${shortDate(account.invitationExpiresAt)}` : '없음'} />
        </div>
    );
}

function ManagementTab({
    detail,
    onStartEdit,
    onArchive,
    onHardDelete,
}: {
    detail: StaffDetail;
    onStartEdit: () => void;
    onArchive: () => void;
    onHardDelete: () => void;
}) {
    return (
        <div className="space-y-4">
            {detail.permissions.canEdit && (
                <div className="rounded-xl border bg-card p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <p className="text-sm font-medium">인사 정보 수정</p>
                            <p className="mt-1 text-sm text-muted-foreground">연락처, 역할, 상태, 시급, 메모를 수정합니다.</p>
                        </div>
                        <Button type="button" variant="outline" onClick={onStartEdit}>
                            <Pencil className="mr-2 h-4 w-4" />
                            수정
                        </Button>
                    </div>
                </div>
            )}
            {detail.permissions.canArchive && (
                <div className="rounded-xl border border-warning/30 bg-warning-soft p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <p className="text-sm font-medium text-warning-foreground">퇴사/보관</p>
                            <p className="mt-1 text-sm text-warning-foreground">운영 목록에서 숨기고 계정 권한과 미래 시간표 연결을 정리합니다. 과거 급여와 수업 이력은 보존됩니다.</p>
                        </div>
                        <Button type="button" variant="outline" onClick={onArchive} disabled={detail.summary.status === 'inactive'}>
                            퇴사/보관
                        </Button>
                    </div>
                </div>
            )}
            {detail.permissions.canHardDelete && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <p className="text-sm font-medium text-destructive">오등록 완전삭제</p>
                            <p className="mt-1 text-sm text-destructive">급여, 반 배정, 수업, 계정 이력이 없는 경우에만 삭제할 수 있습니다.</p>
                            {detail.hardDeletePreview && !detail.hardDeletePreview.canHardDelete && (
                                <p className="mt-2 text-xs text-destructive">
                                    이력 {detail.hardDeletePreview.historicalRecordCount}건 또는 공유 신원 {detail.hardDeletePreview.sharedIdentityCount}건이 있어 차단됩니다.
                                </p>
                            )}
                        </div>
                        <Button type="button" variant="destructive" onClick={onHardDelete} disabled={detail.hardDeletePreview ? !detail.hardDeletePreview.canHardDelete : false}>
                            완전삭제
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

export function InstructorsOperationsPage({ initialStaffId = '' }: { initialStaffId?: string }) {
    const { profile } = useAuth();
    const academyId = academyIdOf(profile?.current_academy_id);
    const [staff, setStaff] = useState<StaffSummary[]>([]);
    const [permissions, setPermissions] = useState<StaffOperationsPermissions>(emptyPermissions);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const nextCursorRef = useRef<string | null>(null);
    const [error, setError] = useState('');
    const [selectedStaffId, setSelectedStaffId] = useState('');
    const [detail, setDetail] = useState<StaffDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('overview');
    const [searchQuery, setSearchQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState<StaffRoleFilter>('all');
    const [statusFilter, setStatusFilter] = useState<StaffFilterStatus>('operations');
    const [sortMode, setSortMode] = useState<StaffSortMode>('name');
    const [filtersHydrated, setFiltersHydrated] = useState(false);
    const requestedRosterFilters = useMemo(() => ({
        q: searchQuery.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ko-KR'),
        role: roleFilter,
        status: statusFilter,
    }), [roleFilter, searchQuery, statusFilter]);
    const rosterFilters = useDebouncedValue(requestedRosterFilters, 300);
    const rosterFiltersReady = filtersHydrated
        && rosterFilters.q === requestedRosterFilters.q
        && rosterFilters.role === requestedRosterFilters.role
        && rosterFilters.status === requestedRosterFilters.status;
    const rosterRequestSequence = useRef(0);
    const rosterAbortController = useMemo(() => new LatestAbortController(), []);
    const [formMode, setFormMode] = useState<FormMode>(null);
    const [submitting, setSubmitting] = useState(false);
    const [archiveOpen, setArchiveOpen] = useState(false);
    const [hardDeleteOpen, setHardDeleteOpen] = useState(false);
    const [hardDeletePasswordOpen, setHardDeletePasswordOpen] = useState(false);
    const [hardDeletePreview, setHardDeletePreview] = useState<StaffHardDeletePreview | null>(null);
    const [hardDeleteConfirmName, setHardDeleteConfirmName] = useState('');
    const [serviceMonth, setServiceMonth] = useState(currentMonth());

    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<StaffRole>('instructor');
    const [staffStatus, setStaffStatus] = useState<StaffStatus>('active');
    const [hourlyRate, setHourlyRate] = useState('');
    const [hireDate, setHireDate] = useState('');
    const [qualifications, setQualifications] = useState('');
    const [notes, setNotes] = useState('');

    const [paymentSubmitting, setPaymentSubmitting] = useState(false);
    const [paymentDate, setPaymentDate] = useState(today());
    const [paymentGrossAmount, setPaymentGrossAmount] = useState('');
    const [paymentHoursWorked, setPaymentHoursWorked] = useState('');
    const [paymentHourlyRate, setPaymentHourlyRate] = useState('');
    const [paymentWithholdingType, setPaymentWithholdingType] = useState<WithholdingType>('freelance_3.3');
    const [paymentMethod, setPaymentMethod] = useState('계좌이체');
    const [paymentRecipientName, setPaymentRecipientName] = useState('');
    const [paymentNotes, setPaymentNotes] = useState('');

    useEffect(() => {
        const readUrlState = () => {
            const params = new URLSearchParams(window.location.search);
            setSelectedStaffId(params.get('staffId') || initialStaffId);
            setSearchQuery(params.get('q') || '');
            setRoleFilter((params.get('role') as StaffRoleFilter | null) || 'all');
            setStatusFilter((params.get('status') as StaffFilterStatus | null) || 'operations');
            setSortMode((params.get('sort') as StaffSortMode | null) || 'name');
            setFiltersHydrated(true);
        };
        readUrlState();
        window.addEventListener('popstate', readUrlState);
        return () => window.removeEventListener('popstate', readUrlState);
    }, [initialStaffId]);

    useEffect(() => {
        if (!rosterFiltersReady) return;
        const params = new URLSearchParams(window.location.search);
        const setOrDelete = (key: string, value: string, defaultValue: string) => {
            if (!value || value === defaultValue) params.delete(key);
            else params.set(key, value);
        };
        setOrDelete('staffId', selectedStaffId, '');
        setOrDelete('q', rosterFilters.q, '');
        setOrDelete('role', rosterFilters.role, 'all');
        setOrDelete('status', rosterFilters.status, 'operations');
        setOrDelete('sort', sortMode, 'name');
        const search = params.toString();
        window.history.replaceState(null, '', search ? `${window.location.pathname}?${search}` : window.location.pathname);
    }, [rosterFilters, rosterFiltersReady, selectedStaffId, sortMode]);

    useEffect(() => {
        if (!filtersHydrated) return;
        rosterAbortController.abort();
        rosterRequestSequence.current += 1;
        nextCursorRef.current = null;
        setHasMore(false);
    }, [filtersHydrated, roleFilter, rosterAbortController, searchQuery, statusFilter]);

    useEffect(() => () => {
        rosterAbortController.abort();
        rosterRequestSequence.current += 1;
    }, [rosterAbortController]);

    const load = useCallback(async (options: { force?: boolean; background?: boolean; append?: boolean } = {}) => {
        if (!academyId || !rosterFiltersReady) return;
        const controller = rosterAbortController.start();
        const requestSequence = rosterRequestSequence.current + 1;
        rosterRequestSequence.current = requestSequence;
        if (!options.append) {
            nextCursorRef.current = null;
            setHasMore(false);
        }
        if (options.append) setLoadingMore(true);
        else if (options.background) setRefreshing(true);
        else setLoading(true);
        if (!options.append) setError('');
        try {
            const data = await loadStaffOperationsOverview(academyId, {
                force: options.force,
                cursor: options.append ? nextCursorRef.current : null,
                q: rosterFilters.q,
                role: rosterFilters.role,
                status: rosterFilters.status,
                signal: controller.signal,
            });
            if (controller.signal.aborted || rosterRequestSequence.current !== requestSequence) return;
            setStaff((current) => {
                if (!options.append) return data.staff;
                const byId = new Map(current.map((row) => [row.id, row]));
                for (const row of data.staff) byId.set(row.id, row);
                return [...byId.values()];
            });
            setPermissions(data.permissions);
            nextCursorRef.current = data.nextCursor;
            setHasMore(data.hasMore);
            if (!options.append) {
                setSelectedStaffId((current) => current || data.staff[0]?.id || '');
            }
        } catch (err) {
            if (controller.signal.aborted || rosterRequestSequence.current !== requestSequence) return;
            const message = err instanceof Error ? err.message : '강사 정보를 불러오지 못했습니다.';
            setError(message);
            toast.error(message);
        } finally {
            rosterAbortController.clear(controller);
            if (rosterRequestSequence.current === requestSequence) {
                if (options.append) setLoadingMore(false);
                else if (options.background) setRefreshing(false);
                else setLoading(false);
            }
        }
    }, [academyId, rosterAbortController, rosterFilters, rosterFiltersReady]);

    const loadDetail = useCallback(async (staffId: string, options: { force?: boolean; background?: boolean } = {}) => {
        if (!academyId || !staffId) {
            setDetail(null);
            return;
        }
        if (!options.background) setDetailLoading(true);
        try {
            const data = await loadStaffDetail(academyId, staffId, 'full', serviceMonth, { force: options.force });
            setDetail(data);
            if (data.hardDeletePreview) setHardDeletePreview(data.hardDeletePreview);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '강사 상세 정보를 불러오지 못했습니다.');
            setDetail(null);
        } finally {
            if (!options.background) setDetailLoading(false);
        }
    }, [academyId, serviceMonth]);

    useEffect(() => {
        if (rosterFiltersReady) void load();
    }, [load, rosterFiltersReady]);

    useEffect(() => {
        if (selectedStaffId) void loadDetail(selectedStaffId, { force: true });
    }, [loadDetail, selectedStaffId]);

    useEffect(() => {
        if (!academyId) return undefined;
        return addLmsInvalidationListener((payload) => {
            if (payload.academyId && payload.academyId !== academyId) return;
            const domain = payload.domain || 'lms';
            if (!['staff', 'classes', 'accounting', 'lms', 'admin'].includes(domain)) return;
            void load({ force: true, background: true });
            if (selectedStaffId) void loadDetail(selectedStaffId, { force: true, background: true });
        });
    }, [academyId, load, loadDetail, selectedStaffId]);

    const resetForm = useCallback(() => {
        setFormMode(null);
        setName('');
        setPhone('');
        setEmail('');
        setRole('instructor');
        setStaffStatus('active');
        setHourlyRate('');
        setHireDate('');
        setQualifications('');
        setNotes('');
    }, []);

    const startCreate = () => {
        resetForm();
        setFormMode('create');
        setActiveTab('profile');
    };

    const startEdit = () => {
        if (!detail) return;
        const row = detail.summary;
        setName(row.name);
        setPhone(row.phone || '');
        setEmail(row.email || '');
        setRole(row.role === 'owner' ? 'admin' : row.role);
        setStaffStatus(row.status);
        setHourlyRate(row.hourlyRate === null || row.hourlyRate === undefined ? '' : String(row.hourlyRate));
        setHireDate(row.hireDate || '');
        setQualifications(row.qualifications || '');
        setNotes(row.notes || '');
        setFormMode('edit');
        setActiveTab('profile');
    };

    const submitStaff = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!academyId) return;
        setSubmitting(true);
        try {
            const payload = {
                name: name.trim(),
                phone: phone.trim() || null,
                email: email.trim() || null,
                role,
                hourlyRate: hourlyRate ? Number(hourlyRate) : null,
                hireDate: hireDate || null,
                qualifications: qualifications.trim() || null,
                notes: notes.trim() || null,
            };
            if (formMode === 'edit' && selectedStaffId) {
                await updateStaff(academyId, selectedStaffId, { ...payload, status: staffStatus });
                toast.success('강사/직원 정보를 수정했습니다.');
            } else {
                await createStaff(academyId, payload);
                toast.success('강사/직원을 등록했습니다.');
            }
            resetForm();
            await load({ force: true });
            if (selectedStaffId) await loadDetail(selectedStaffId, { force: true });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '강사/직원 저장에 실패했습니다.');
        } finally {
            setSubmitting(false);
        }
    };

    const submitPayment = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!academyId || !detail) return;
        setPaymentSubmitting(true);
        try {
            const input: CreateInstructorPaymentInput = {
                instructorId: detail.summary.id,
                recipientName: paymentRecipientName.trim() || detail.summary.name,
                serviceMonth,
                paymentDate,
                grossAmount: Number(paymentGrossAmount) || 0,
                withholdingType: paymentWithholdingType,
                hoursWorked: paymentHoursWorked ? Number(paymentHoursWorked) : null,
                hourlyRate: paymentHourlyRate ? Number(paymentHourlyRate) : detail.summary.hourlyRate ?? null,
                paymentMethod,
                status: 'paid',
                notes: paymentNotes.trim() || null,
            };
            await createInstructorPayment(academyId, input);
            toast.success('강사 지급 기록을 저장했습니다.');
            setPaymentGrossAmount('');
            setPaymentHoursWorked('');
            setPaymentHourlyRate('');
            setPaymentRecipientName('');
            setPaymentNotes('');
            await loadDetail(detail.summary.id, { force: true });
            await load({ force: true, background: true });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '강사 지급 기록 저장에 실패했습니다.');
        } finally {
            setPaymentSubmitting(false);
        }
    };

    const executeArchive = async () => {
        if (!academyId || !selectedStaffId) return;
        try {
            await archiveStaff(academyId, selectedStaffId);
            toast.success('강사/직원을 퇴사/보관 처리했습니다.');
            setArchiveOpen(false);
            setSelectedStaffId('');
            setDetail(null);
            await load({ force: true });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '퇴사/보관 처리에 실패했습니다.');
        }
    };

    const openHardDelete = async () => {
        if (!academyId || !selectedStaffId) return;
        setHardDeleteOpen(true);
        setHardDeleteConfirmName('');
        setHardDeletePreview(null);
        try {
            setHardDeletePreview(await previewHardDeleteStaff(academyId, selectedStaffId));
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '완전삭제 가능 여부를 확인하지 못했습니다.');
        }
    };

    const executeHardDelete = async () => {
        if (!academyId || !selectedStaffId) return;
        try {
            await hardDeleteStaff(academyId, selectedStaffId, hardDeleteConfirmName);
            toast.success('오등록 강사/직원을 완전삭제했습니다.');
            setHardDeletePasswordOpen(false);
            setHardDeleteOpen(false);
            setSelectedStaffId('');
            setDetail(null);
            await load({ force: true });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '완전삭제에 실패했습니다.');
        }
    };

    const filteredStaff = useMemo(() => {
        const query = requestedRosterFilters.q;
        const filtered = staff.filter((row) => {
            if (statusFilter === 'operations' && row.status !== 'active' && row.status !== 'on_leave') return false;
            if (statusFilter !== 'operations' && statusFilter !== 'all' && row.status !== statusFilter) return false;
            if (roleFilter !== 'all' && row.role !== roleFilter) return false;
            if (!query) return true;
            return [
                row.name,
                row.phone,
                row.email,
                row.role,
                roleLabel(row.role),
                ...(row.classNames || []),
            ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
        });
        return sortStaff(filtered, sortMode);
    }, [requestedRosterFilters.q, roleFilter, sortMode, staff, statusFilter]);

    if (!academyId) {
        return (
            <PageShell title="강사" description="학원 연결 정보가 필요합니다." icon={Users}>
                <ErrorState title="현재 학원 정보를 찾을 수 없습니다." />
            </PageShell>
        );
    }

    const selectedStaff = staff.find((row) => row.id === selectedStaffId) || null;
    const canShowManagement = Boolean(detail && (detail.permissions.canEdit || detail.permissions.canArchive || detail.permissions.canHardDelete));

    return (
        <PageShell
            title="강사"
            description="강사/직원 원장, 담당 반, 시간표, 급여, 계정 상태를 한 화면에서 확인합니다."
            icon={Users}
            actions={permissions.canCreate ? (
                <Button type="button" onClick={startCreate}>
                    <Plus className="mr-2 h-4 w-4" />
                    강사 등록
                </Button>
            ) : undefined}
        >
            {!loading && refreshing && (
                <PageStatusBar tone="neutral" className="text-xs">
                    <span className="flex items-center gap-2">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        최신 데이터를 동기화하는 중
                    </span>
                </PageStatusBar>
            )}
            {loading && <SkeletonPage />}
            {!loading && error && <ErrorState title={error} retryLabel="다시 시도" onRetry={() => void load({ force: true })} />}
            {!loading && !error && (
                <div className="grid min-h-[620px] gap-5 xl:grid-cols-[0.9fr_1.5fr]">
                    <Card className="overflow-hidden">
                        <CardHeader className="space-y-4">
                            <div className="flex items-center justify-between gap-3">
                                <CardTitle>강사/직원 목록</CardTitle>
                                {permissions.scopedToPeerClasses && (
                                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">공유 반 기준</span>
                                )}
                            </div>
                            <div className="grid gap-2">
                                <div className="relative">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input className="pl-9" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="이름, 연락처, 반 검색" />
                                </div>
                                <div className="grid gap-2 sm:grid-cols-3">
                                    <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as StaffRoleFilter)}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">전체 역할</SelectItem>
                                            <SelectItem value="instructor">강사</SelectItem>
                                            <SelectItem value="teacher">교사</SelectItem>
                                            <SelectItem value="staff">직원</SelectItem>
                                            <SelectItem value="admin">관리자</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StaffFilterStatus)}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="operations">운영 인원</SelectItem>
                                            <SelectItem value="all">전체 상태</SelectItem>
                                            <SelectItem value="active">재직</SelectItem>
                                            <SelectItem value="on_leave">휴직</SelectItem>
                                            <SelectItem value="inactive">퇴사/비활성</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <Select value={sortMode} onValueChange={(value) => setSortMode(value as StaffSortMode)}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="name">이름순</SelectItem>
                                            <SelectItem value="classes">담당 반순</SelectItem>
                                            <SelectItem value="recentPayment">최근 지급순</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <StaffList staff={filteredStaff} selectedStaffId={selectedStaffId} onSelect={(row) => {
                                setSelectedStaffId(row.id);
                                setFormMode(null);
                            }} />
                            {hasMore && (
                                <div className="border-t p-3">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="w-full"
                                        disabled={loadingMore}
                                        onClick={() => void load({ append: true })}
                                    >
                                        {loadingMore ? '강사/직원을 불러오는 중...' : '강사/직원 더 보기'}
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {formMode && permissions.canCreate ? (
                        <Card>
                            <CardHeader><CardTitle>{formMode === 'create' ? '강사/직원 등록' : '강사/직원 수정'}</CardTitle></CardHeader>
                            <CardContent>
                                <StaffForm
                                    mode={formMode}
                                    submitting={submitting}
                                    name={name}
                                    phone={phone}
                                    email={email}
                                    role={role}
                                    status={staffStatus}
                                    hourlyRate={hourlyRate}
                                    hireDate={hireDate}
                                    qualifications={qualifications}
                                    notes={notes}
                                    onName={setName}
                                    onPhone={setPhone}
                                    onEmail={setEmail}
                                    onRole={setRole}
                                    onStatus={setStaffStatus}
                                    onHourlyRate={setHourlyRate}
                                    onHireDate={setHireDate}
                                    onQualifications={setQualifications}
                                    onNotes={setNotes}
                                    onCancel={resetForm}
                                    onSubmit={submitStaff}
                                />
                            </CardContent>
                        </Card>
                    ) : detailLoading ? (
                        <StaffDetailSkeleton />
                    ) : detail ? (
                        <Card className="overflow-hidden">
                            <CardHeader className="border-b">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <CardTitle>{detail.summary.name}</CardTitle>
                                            <StatusBadge status={detail.summary.status} label={statusLabel(detail.summary.status)} />
                                            <StatusBadge status={detail.summary.role} label={roleLabel(detail.summary.role)} tone={roleTone(detail.summary.role)} />
                                        </div>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            {(detail.summary.classNames || []).join(', ') || '담당 반 없음'}
                                            {!detail.summary.visibleToPeerOnly && ` · ${detail.summary.phone || '연락처 없음'}`}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <div className="rounded-xl bg-muted px-3 py-2 text-right text-xs">
                                            <p className="text-muted-foreground">담당 반</p>
                                            <p className="font-semibold text-foreground">{detail.summary.activeClassCount || 0}개</p>
                                        </div>
                                        <div className="rounded-xl bg-muted px-3 py-2 text-right text-xs">
                                            <p className="text-muted-foreground">상태</p>
                                            <p className="font-semibold text-foreground">{statusLabel(detail.summary.status)}</p>
                                        </div>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="p-4">
                                <Tabs value={activeTab} onValueChange={setActiveTab} variant="underline">
                                    <TabsList className="flex h-auto w-full flex-wrap justify-start overflow-x-auto">
                                        <TabsTrigger value="overview"><Users className="mr-2 h-4 w-4" />개요</TabsTrigger>
                                        {detail.permissions.canViewSensitiveProfile && <TabsTrigger value="profile"><UserRound className="mr-2 h-4 w-4" />프로필</TabsTrigger>}
                                        <TabsTrigger value="classes"><CalendarDays className="mr-2 h-4 w-4" />담당 반·시간표</TabsTrigger>
                                        {detail.permissions.canViewPayroll && <TabsTrigger value="payroll"><CreditCard className="mr-2 h-4 w-4" />급여</TabsTrigger>}
                                        {detail.permissions.canViewAccount && <TabsTrigger value="account"><KeyRound className="mr-2 h-4 w-4" />권한·계정</TabsTrigger>}
                                        {canShowManagement && <TabsTrigger value="manage"><ShieldAlert className="mr-2 h-4 w-4" />관리</TabsTrigger>}
                                    </TabsList>
                                    <TabsContent value="overview"><OverviewTab detail={detail} /></TabsContent>
                                    {detail.permissions.canViewSensitiveProfile && <TabsContent value="profile"><ProfileTab detail={detail} /></TabsContent>}
                                    <TabsContent value="classes"><ClassesTab classes={detail.assignedClasses} schedule={detail.schedule} /></TabsContent>
                                    {detail.permissions.canViewPayroll && (
                                        <TabsContent value="payroll">
                                            <PayrollTab
                                                detail={detail}
                                                serviceMonth={serviceMonth}
                                                onServiceMonth={setServiceMonth}
                                                onSubmitPayment={submitPayment}
                                                paymentState={{
                                                    paymentDate,
                                                    grossAmount: paymentGrossAmount,
                                                    hoursWorked: paymentHoursWorked,
                                                    hourlyRate: paymentHourlyRate,
                                                    withholdingType: paymentWithholdingType,
                                                    paymentMethod,
                                                    recipientName: paymentRecipientName,
                                                    notes: paymentNotes,
                                                    submitting: paymentSubmitting,
                                                    setPaymentDate,
                                                    setGrossAmount: setPaymentGrossAmount,
                                                    setHoursWorked: setPaymentHoursWorked,
                                                    setHourlyRate: setPaymentHourlyRate,
                                                    setWithholdingType: setPaymentWithholdingType,
                                                    setPaymentMethod,
                                                    setRecipientName: setPaymentRecipientName,
                                                    setNotes: setPaymentNotes,
                                                }}
                                            />
                                        </TabsContent>
                                    )}
                                    {detail.permissions.canViewAccount && <TabsContent value="account"><AccountTab detail={detail} /></TabsContent>}
                                    {canShowManagement && (
                                        <TabsContent value="manage">
                                            <ManagementTab detail={detail} onStartEdit={startEdit} onArchive={() => setArchiveOpen(true)} onHardDelete={openHardDelete} />
                                        </TabsContent>
                                    )}
                                </Tabs>
                            </CardContent>
                        </Card>
                    ) : (
                        <EmptyState
                            title="강사/직원을 선택하세요."
                            description={permissions.canCreate ? '새 강사 등록도 가능합니다.' : '목록에서 확인할 인원을 선택하세요.'}
                            action={permissions.canCreate ? <Button type="button" onClick={startCreate}>강사 등록</Button> : undefined}
                        />
                    )}
                </div>
            )}

            <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>퇴사/보관 처리</DialogTitle>
                        <DialogDescription>
                            {detail?.summary.name || selectedStaff?.name} 인원을 운영 목록에서 숨기고 미래 시간표와 권한 연결을 정리합니다. 과거 급여와 수업 이력은 유지됩니다.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setArchiveOpen(false)}>취소</Button>
                        <Button type="button" variant="destructive" onClick={() => void executeArchive()}>퇴사/보관</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={hardDeleteOpen} onOpenChange={setHardDeleteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>오등록 완전삭제</DialogTitle>
                        <DialogDescription>
                            이력이 없는 오등록 강사/직원만 삭제할 수 있습니다. 이력이 있으면 퇴사/보관만 가능합니다.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="rounded-xl border bg-muted p-3 text-sm">
                            <p className="font-medium text-foreground">{hardDeletePreview?.staffName || detail?.summary.name || '-'}</p>
                            {hardDeletePreview ? (
                                <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                                    {hardDeletePreview.blockers.filter((row) => row.count > 0).map((row) => (
                                        <div key={row.key} className="flex justify-between gap-3">
                                            <span>{row.label}</span>
                                            <strong>{row.count.toLocaleString()}건</strong>
                                        </div>
                                    ))}
                                    {hardDeletePreview.canHardDelete && <p className="text-success-foreground">차단 이력이 없어 완전삭제할 수 있습니다.</p>}
                                    {!hardDeletePreview.canHardDelete && <p className="text-destructive">이력이 있어 완전삭제가 차단됩니다.</p>}
                                </div>
                            ) : (
                                <Skeleton className="mt-2 h-10" />
                            )}
                        </div>
                        <FormField label="강사/직원 이름 확인">
                            <Input value={hardDeleteConfirmName} onChange={(event) => setHardDeleteConfirmName(event.target.value)} placeholder={hardDeletePreview?.staffName || detail?.summary.name || ''} />
                        </FormField>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setHardDeleteOpen(false)}>취소</Button>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={!hardDeletePreview?.canHardDelete || hardDeleteConfirmName.trim() !== hardDeletePreview.staffName}
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
                description="오등록 강사/직원과 연결된 임시 데이터가 삭제됩니다. 이력이 있으면 서버에서 다시 차단됩니다."
                confirmLabel="완전삭제"
                onConfirm={executeHardDelete}
            />
        </PageShell>
    );
}
