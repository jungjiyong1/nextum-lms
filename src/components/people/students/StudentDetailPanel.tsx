import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Search, Clock, CreditCard, BookOpen, Edit2, Trash2, Calendar } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { slotToTime } from '../../../core/utils/time';
import type { Student, Enrollment, StudentPayment as Payment, IrregularLessonSchedule } from '../../../core/types';

interface StudentDetailPanelProps {
    student: Student | null;
    enrollments: Enrollment[];
    payments: Payment[];
    irregularLessons: IrregularLessonSchedule[];
    loadingExtras: boolean;
    onEdit: () => void;
    onDelete: () => void;
    onAssign: () => void;
    onUnassign: (id: number) => void;
}

export function StudentDetailPanel({
    student,
    enrollments,
    payments,
    irregularLessons,
    loadingExtras,
    onEdit,
    onDelete,
    onAssign,
    onUnassign
}: StudentDetailPanelProps) {
    if (!student) {
        return (
            <div className="flex-1 overflow-y-auto bg-background p-6">
                <div className="flex h-full flex-col items-center justify-center text-muted-foreground space-y-4">
                    <div className="h-24 w-24 rounded-full bg-muted flex items-center justify-center">
                        <Search className="h-10 w-10 opacity-20" />
                    </div>
                    <p>학생을 선택하여 상세 정보를 확인하세요.</p>
                </div>
            </div>
        );
    }

    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [isUnassignDialogOpen, setIsUnassignDialogOpen] = useState(false);
    const [pendingUnassignId, setPendingUnassignId] = useState<number | null>(null);

    const handleUnassignClick = (enrollmentId: number) => {
        setPendingUnassignId(enrollmentId);
        setIsUnassignDialogOpen(true);
    };

    const confirmUnassign = () => {
        if (pendingUnassignId !== null) {
            onUnassign(pendingUnassignId);
            setPendingUnassignId(null);
        }
    };

    const getStudentName = (s: Student) => s.name || '-';
    const statusLabels: Record<string, string> = {
        'active': '재원',
        'on_leave': '휴원',
        'dropped': '퇴원'
    };
    const schoolTypeLabels: Record<string, string> = {
        'elementary': '초등학교',
        'middle': '중학교',
        'high': '고등학교'
    };
    const paymentMethodLabels: Record<string, string> = {
        'cash': '현금',
        'card': '카드',
        'bank_transfer': '계좌이체',
        'check': '수표',
        'zeropay': '제로페이',
        'auto_transfer': '자동이체',
        'other': '기타'
    };

    const FormatUtils = {
        lessonTime: (day: number | null, start: number | null, end: number | null) => {
            if (day === null || start === null || end === null) return '비정규';
            const days = ['월', '화', '수', '목', '금', '토', '일'];
            return `${days[day]} ${slotToTime(start)}-${slotToTime(end)}`;
        },
        // Format irregular lesson time: "01/31(금) 09:00-11:00"
        irregularTime: (date: string, startTime: string, endTime: string) => {
            const d = new Date(date);
            const days = ['일', '월', '화', '수', '목', '금', '토'];
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const dayName = days[d.getDay()];
            return `${month}/${day}(${dayName}) ${startTime.slice(0, 5)}-${endTime.slice(0, 5)}`;
        }
    };

    return (
        <div className="flex-1 overflow-y-auto bg-background p-6">
            <div className="space-y-6 max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-2 duration-300">
                {/* Header */}
                <div className="flex items-center gap-4 border-b pb-6">
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-3xl font-bold text-primary">
                        {getStudentName(student).charAt(0)}
                    </div>
                    <div className="flex-1">
                        <h1 className="text-2xl font-bold">{getStudentName(student)}</h1>
                        <div className="flex gap-2 mt-2">
                            <span className={cn(
                                "px-2.5 py-0.5 rounded-full text-sm font-medium",
                                student.status === 'active' ? "bg-green-100 text-green-700" :
                                    student.status === 'on_leave' ? "bg-yellow-100 text-yellow-700" :
                                        "bg-red-100 text-red-700"
                            )}>
                                {statusLabels[student.status]}
                            </span>
                            {student.school_type && (
                                <span className="px-2.5 py-0.5 rounded-full text-sm bg-blue-50 text-blue-700">
                                    {schoolTypeLabels[student.school_type]} {student.grade}학년
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={onAssign}>
                            <BookOpen className="h-4 w-4 mr-2" />
                            강의 배정
                        </Button>
                        <Button variant="outline" size="icon" onClick={onEdit}>
                            <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button variant="destructive" size="icon" onClick={() => setIsDeleteDialogOpen(true)}>
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                    {/* Basic Info */}
                    <Card className="p-4 space-y-3">
                        <h3 className="font-semibold flex items-center gap-2"><Clock className="h-4 w-4" /> 상세 정보</h3>
                        <div className="grid grid-cols-[100px_1fr] gap-2 text-sm">
                            <span className="text-muted-foreground">전화번호</span>
                            <span>{student.phone || '-'}</span>
                            <span className="text-muted-foreground">생년월일</span>
                            <span>{student.date_of_birth || '-'}</span>
                        </div>
                    </Card>

                    {/* Parent Info */}
                    <Card className="p-4 space-y-3">
                        <h3 className="font-semibold flex items-center gap-2">학부모 정보</h3>
                        <div className="grid grid-cols-[100px_1fr] gap-2 text-sm">
                            <span className="text-muted-foreground">이름</span>
                            <span>{student.parent_name || '-'}</span>
                            <span className="text-muted-foreground">연락처</span>
                            <span>{student.parent_phone || '-'}</span>
                        </div>
                    </Card>

                    {/* Payment Info */}
                    <Card className="p-4 space-y-3">
                        <h3 className="font-semibold flex items-center gap-2"><CreditCard className="h-4 w-4" /> 결제 정보</h3>
                        <div className="grid grid-cols-[100px_1fr] gap-2 text-sm">
                            <span className="text-muted-foreground">월 수강료</span>
                            <span className="font-medium text-green-700">
                                {student.monthly_tuition ? `₩${student.monthly_tuition.toLocaleString()}` : '-'}
                            </span>
                            <span className="text-muted-foreground">결제 주기</span>
                            <span>매월 {student.payment_cycle_day}일</span>
                            <span className="text-muted-foreground">최근 결제</span>
                            <span>{student.last_payment_date || '-'}</span>
                        </div>
                    </Card>

                    {/* Memo */}
                    <Card className="p-4 space-y-3">
                        <h3 className="font-semibold">메모</h3>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                            {student.notes || '메모 없음'}
                        </p>
                    </Card>
                </div>

                {/* Enrollments */}
                <div className="space-y-3">
                    <h3 className="font-semibold text-lg">수강 목록</h3>
                    {loadingExtras ? <Skeleton className="h-20 w-full" /> :
                        enrollments.length === 0 ? <Card className="p-4 text-center text-muted-foreground">등록된 수업이 없습니다.</Card> :
                            (
                                <div className="grid gap-2">
                                    {enrollments.map(e => (
                                        <div key={e.id} className="flex items-center justify-between border rounded-lg p-3 bg-card">
                                            <div>
                                                <div className="font-medium">{e.lesson_title}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    {e.instructor_name} • {FormatUtils.lessonTime(e.day, e.start_slot, e.end_slot)}
                                                </div>
                                            </div>
                                            <Button variant="ghost" size="sm" onClick={() => handleUnassignClick(e.id)}>해제</Button>
                                        </div>
                                    ))}
                                </div>
                            )
                    }
                </div>

                {/* Irregular Lessons */}
                <div className="space-y-3">
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-orange-500" />
                        예정된 비정규 수업
                        {irregularLessons.length > 0 && (
                            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                                {irregularLessons.length}
                            </span>
                        )}
                    </h3>
                    {loadingExtras ? <Skeleton className="h-20 w-full" /> :
                        irregularLessons.length === 0 ? <Card className="p-4 text-center text-muted-foreground border-dashed">예정된 비정규 수업이 없습니다.</Card> :
                            (
                                <div className="grid gap-2">
                                    {irregularLessons.map(l => (
                                        <div key={l.schedule_id} className="flex items-center justify-between border border-dashed border-orange-300 rounded-lg p-3 bg-orange-50/50">
                                            <div>
                                                <div className="font-medium">{l.lesson_title}</div>
                                                <div className="text-xs text-orange-600 font-medium">
                                                    {FormatUtils.irregularTime(l.date, l.start_time, l.end_time)}
                                                    <span className="text-muted-foreground font-normal ml-2">{l.classroom_name}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )
                    }
                </div>

                {/* Payment History */}
                <div className="space-y-3">
                    <h3 className="font-semibold text-lg">납부 이력</h3>
                    {loadingExtras ? <Skeleton className="h-20 w-full" /> :
                        payments.length === 0 ? <Card className="p-4 text-center text-muted-foreground">납부 이력이 없습니다.</Card> :
                            (
                                <div className="flex flex-col gap-1">
                                    {payments.slice(0, 10).map(p => (
                                        <div key={p.id} className="flex justify-between items-center text-sm p-2 border-b last:border-0 hover:bg-muted/50 rounded">
                                            <span className="text-muted-foreground">{p.payment_date}</span>
                                            <span className="font-medium">₩{p.amount.toLocaleString()}</span>
                                            <span className="text-xs px-2 py-0.5 bg-muted rounded">{paymentMethodLabels[p.payment_method] || p.payment_method}</span>
                                        </div>
                                    ))}
                                    {payments.length > 10 && <div className="text-center text-xs text-muted-foreground pt-2">... 외 {payments.length - 10}건</div>}
                                </div>
                            )
                    }
                </div>
            </div>

            {/* 삭제 확인 다이얼로그 */}
            <ConfirmDialog
                open={isDeleteDialogOpen}
                onOpenChange={setIsDeleteDialogOpen}
                title="학생 삭제"
                description={`'${student.name}' 학생을 정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`}
                confirmLabel="삭제"
                cancelLabel="취소"
                variant="destructive"
                onConfirm={onDelete}
            />

            {/* 수강 해제 확인 다이얼로그 */}
            <ConfirmDialog
                open={isUnassignDialogOpen}
                onOpenChange={setIsUnassignDialogOpen}
                title="수강 해제"
                description="해당 수강을 해제하시겠습니까?"
                confirmLabel="해제"
                cancelLabel="취소"
                variant="destructive"
                onConfirm={confirmUnassign}
            />
        </div>
    );
}
