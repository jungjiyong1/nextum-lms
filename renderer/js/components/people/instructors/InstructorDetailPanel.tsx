import React, { useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Trash2, Edit2, ChevronLeft, ChevronRight, User, Calendar as CalendarIcon, Edit, Users, BookOpen } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { slotToTime } from '../../../core/utils/time';
import type { Instructor, SalaryData, InstructorScheduleItem, InstructorPayment, InstructorLessonSummary, IrregularLessonSchedule } from '../../../core/types';

interface InstructorDetailPanelProps {
    instructor: Instructor | null;
    salaryData: SalaryData | null;
    calendarData: InstructorScheduleItem[];
    payments: InstructorPayment[];
    lessons: InstructorLessonSummary[];
    irregularLessons: IrregularLessonSchedule[];
    loading: boolean;
    currentYear: number;
    currentMonth: number;
    onMonthChange: (delta: number) => void;
    onEdit: () => void;
    onDelete: () => void;
    onLessonCreate?: () => void;
    onLessonEdit?: (lessonId: number) => void;
    onStudentManage?: (lessonId: number) => void;
    onRefresh?: () => void;
}

export function InstructorDetailPanel({
    instructor,
    salaryData,
    calendarData,
    payments,
    lessons,
    irregularLessons,
    loading,
    currentYear,
    currentMonth,
    onMonthChange,
    onEdit,
    onDelete,
    onLessonCreate,
    onLessonEdit,
    onStudentManage,
    onRefresh
}: InstructorDetailPanelProps) {
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

    // Simple lesson context menu state
    const [lessonContextMenu, setLessonContextMenu] = useState<{ x: number, y: number, lessonId: number, lessonTitle: string } | null>(null);

    const closeLessonContextMenu = useCallback(() => {
        setLessonContextMenu(null);
    }, []);

    const handleLessonContextMenu = (e: React.MouseEvent, lessonId: number, lessonTitle: string) => {
        e.preventDefault();
        e.stopPropagation();
        setLessonContextMenu({ x: e.clientX, y: e.clientY, lessonId, lessonTitle });
    };

    // Calendar Days Generation
    const calendarDays = useMemo(() => {
        const firstDay = new Date(currentYear, currentMonth - 1, 1);
        const lastDay = new Date(currentYear, currentMonth, 0);
        const daysInMonth = lastDay.getDate();
        const startDayOfWeek = firstDay.getDay(); // 0=Sun

        const days = [];
        // Empty slots
        for (let i = 0; i < startDayOfWeek; i++) {
            days.push(null);
        }
        // Days
        for (let i = 1; i <= daysInMonth; i++) {
            const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            const daySchedules = calendarData.filter(s => s.date === dateStr);
            days.push({
                day: i,
                dateStr,
                schedules: daySchedules
            });
        }
        return days;
    }, [currentYear, currentMonth, calendarData]);

    const selectedDateSchedules = useMemo(() => {
        if (!selectedDate) return [];
        return calendarData.filter(s => s.date === selectedDate);
    }, [selectedDate, calendarData]);

    // 담당 수업을 요일순(월화수목금토일)으로 정렬
    const sortedLessons = useMemo(() => {
        return [...lessons]
            .filter(l => l.day !== null && l.start_slot !== null && l.end_slot !== null)
            .sort((a, b) => {
                // day: 0=월, 1=화, ..., 6=일 순서로 정렬
                if (a.day !== b.day) return (a.day ?? 0) - (b.day ?? 0);
                // 같은 요일이면 시작 시간순
                return (a.start_slot ?? 0) - (b.start_slot ?? 0);
            });
    }, [lessons]);

    // 비정규 수업을 날짜+시간순으로 정렬
    const sortedIrregularLessons = useMemo(() => {
        return [...irregularLessons].sort((a, b) => {
            // 날짜 비교
            const dateCompare = a.date.localeCompare(b.date);
            if (dateCompare !== 0) return dateCompare;
            // 같은 날짜면 시작 시간순
            return a.start_time.localeCompare(b.start_time);
        });
    }, [irregularLessons]);

    // Format Helper
    const formatLessonTime = (day: number | null, start: number | null, end: number | null) => {
        if (day === null || start === null || end === null) return '비정규';
        const days = ['월', '화', '수', '목', '금', '토', '일'];
        return `${days[day]} ${slotToTime(start)}-${slotToTime(end)}`;
    };

    // Format irregular lesson time: "01/31(금) 09:00-11:00"
    const formatIrregularTime = (date: string, startTime: string, endTime: string) => {
        const d = new Date(date);
        const days = ['일', '월', '화', '수', '목', '금', '토'];
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const dayName = days[d.getDay()];
        return `${month}/${day}(${dayName}) ${startTime.slice(0, 5)}-${endTime.slice(0, 5)}`;
    };

    if (!instructor) {
        return (
            <div className="flex-1 overflow-y-auto bg-background p-6">
                <div className="flex h-full flex-col items-center justify-center text-muted-foreground space-y-4">
                    <div className="h-24 w-24 rounded-full bg-muted flex items-center justify-center">
                        <User className="h-10 w-10 opacity-20" />
                    </div>
                    <p>강사를 선택하여 상세 정보를 확인하세요.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto bg-background p-6">
            <div className="max-w-4xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between border-b pb-4">
                    <div className="flex items-center gap-4">
                        <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
                            {(instructor.name || '').charAt(0)}
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold">{instructor.name}</h1>
                            {instructor.hire_date && (
                                <div className="flex gap-2 mt-1">
                                    <span className="text-xs text-muted-foreground px-2 py-0.5 bg-muted rounded">입사: {instructor.hire_date}</span>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={onLessonCreate}>
                            <BookOpen className="h-4 w-4 mr-2" />
                            강의 추가
                        </Button>
                        <Button variant="outline" size="icon" onClick={onEdit}>
                            <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button variant="destructive" size="icon" onClick={() => setIsDeleteDialogOpen(true)}>
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* Additional Lists Grid - 담당수업(2행) | 비정규수업/지급내역 */}
                <div className="grid grid-cols-2 grid-rows-2 gap-6">
                    {/* Lessons - spans 2 rows */}
                    <Card className="row-span-2">
                        <CardHeader className="py-3"><CardTitle className="text-base">담당 수업</CardTitle></CardHeader>
                        <CardContent className="p-0">
                            <div className="max-h-[420px] overflow-y-auto">
                                {sortedLessons.length === 0 ? <div className="p-4 text-sm text-muted-foreground text-center">수업 없음</div> : (
                                    sortedLessons.map((l, i) => (
                                        <div
                                            key={i}
                                            className="p-3 border-b last:border-0 hover:bg-muted/20 cursor-pointer"
                                            onContextMenu={(e) => handleLessonContextMenu(e, l.lesson_id, l.title)}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="font-medium text-sm">
                                                    {l.title}
                                                    <span className="text-muted-foreground font-normal ml-2">({l.classroom_name})</span>
                                                </div>
                                            </div>
                                            <div className="text-xs text-muted-foreground flex justify-between items-center mt-1">
                                                <span>{formatLessonTime(l.day, l.start_slot, l.end_slot)}</span>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-auto text-xs px-2 py-0.5 bg-primary/10 text-primary hover:bg-primary/20"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onStudentManage?.(l.lesson_id);
                                                    }}
                                                >
                                                    <Users className="w-3 h-3 mr-1" />학생 배정
                                                </Button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Irregular Lessons - top right */}
                    <Card className="border-dashed">
                        <CardHeader className="py-3">
                            <CardTitle className="text-base flex items-center gap-2">
                                예정된 비정규 수업
                                {sortedIrregularLessons.length > 0 && (
                                    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                                        {sortedIrregularLessons.length}
                                    </span>
                                )}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="max-h-[150px] overflow-y-auto">
                                {sortedIrregularLessons.length === 0 ? (
                                    <div className="p-4 text-sm text-muted-foreground text-center">예정된 비정규 수업 없음</div>
                                ) : (
                                    sortedIrregularLessons.map((l, i) => (
                                        <div
                                            key={i}
                                            className="p-3 border-b last:border-0 hover:bg-muted/20 cursor-pointer"
                                            onContextMenu={(e) => handleLessonContextMenu(e, l.lesson_id, l.lesson_title)}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="font-medium text-sm">
                                                    {l.lesson_title}
                                                    <span className="text-muted-foreground font-normal ml-2">({l.classroom_name})</span>
                                                </div>
                                            </div>
                                            <div className="text-xs text-muted-foreground flex justify-between items-center mt-1">
                                                <span className="text-orange-600 font-medium">{formatIrregularTime(l.date, l.start_time, l.end_time)}</span>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-auto text-xs px-2 py-0.5 bg-primary/10 text-primary hover:bg-primary/20"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onStudentManage?.(l.lesson_id);
                                                    }}
                                                >
                                                    <Users className="w-3 h-3 mr-1" />학생 배정
                                                </Button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Payments - bottom right */}
                    <Card>
                        <CardHeader className="py-3"><CardTitle className="text-base">지급 내역</CardTitle></CardHeader>
                        <CardContent className="p-0">
                            <div className="max-h-[150px] overflow-y-auto">
                                {payments.length === 0 ? <div className="p-4 text-sm text-muted-foreground text-center">내역 없음</div> : (
                                    payments.slice(0, 10).map((p, i) => (
                                        <div key={i} className="p-3 border-b last:border-0 flex justify-between items-center text-sm hover:bg-muted/20">
                                            <span className="text-muted-foreground">{p.payment_date}</span>
                                            <span className="font-medium">₩{p.amount.toLocaleString()}</span>
                                        </div>
                                    ))
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Calendar */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold flex items-center gap-2"><CalendarIcon className="h-5 w-5" /> 강의 일정</h3>
                        <div className="flex items-center gap-2 bg-muted rounded-md p-0.5">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onMonthChange(-1)}><ChevronLeft className="h-4 w-4" /></Button>
                            <span className="text-sm font-medium min-w-[80px] text-center">{currentYear}.{String(currentMonth).padStart(2, '0')}</span>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onMonthChange(1)}><ChevronRight className="h-4 w-4" /></Button>
                        </div>
                    </div>
                    <div className="border rounded-lg overflow-hidden bg-card">
                        <div className="grid grid-cols-7 text-center text-xs text-muted-foreground bg-muted/30 py-1.5 font-medium border-b">
                            <div className="text-red-500">일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div className="text-blue-500">토</div>
                        </div>
                        <div className="grid grid-cols-7 min-h-[200px] auto-rows-[minmax(60px,auto)] bg-background">
                            {calendarDays.map((day, i) => (
                                <div
                                    key={i}
                                    className={cn(
                                        "border-b border-r last:border-r-0 relative p-1 cursor-pointer hover:bg-accent/30 transition-colors",
                                        !day ? "bg-muted/50" : "",
                                        selectedDate === day?.dateStr ? "bg-primary/10 ring-1 ring-inset ring-primary" : ""
                                    )}
                                    onClick={() => day && setSelectedDate(day.dateStr)}
                                >
                                    {day && (
                                        <>
                                            <div className={cn("text-xs font-medium mb-1", day.dateStr === new Date().toISOString().split('T')[0] ? "bg-primary text-primary-foreground w-5 h-5 rounded-full flex items-center justify-center" : "")}>{day.day}</div>
                                            {day.schedules.length > 0 && (
                                                <div className="space-y-0.5">
                                                    <div className="text-[10px] bg-blue-100 text-blue-700 px-1 rounded truncate">
                                                        {day.schedules.length}건
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                    {/* Day Detail */}
                    {selectedDate && (
                        <div className="bg-muted/20 border rounded-lg p-3 text-sm animate-in fade-in slide-in-from-top-1">
                            <h4 className="font-semibold mb-2">{selectedDate} 상세 일정</h4>
                            {selectedDateSchedules.length === 0 ? <span className="text-muted-foreground">일정 없음</span> : (
                                <div className="space-y-1">
                                    {selectedDateSchedules.map((s, idx) => (
                                        <div
                                            key={idx}
                                            className={cn(
                                                "flex justify-between border-b last:border-0 pb-1 cursor-pointer hover:bg-muted/30 rounded px-1 -mx-1",
                                                s.status === 'cancelled' && "opacity-50 line-through"
                                            )}
                                            onContextMenu={(e) => handleLessonContextMenu(e, s.lesson_id, s.lesson_title)}
                                        >
                                            <span>
                                                {s.start_time}-{s.end_time}{' '}
                                                <span className="font-medium">{s.lesson_title}</span>
                                                {s.substitute_instructor_name && (
                                                    <span className="text-orange-600 text-xs ml-1">
                                                        (대타: {s.substitute_instructor_name})
                                                    </span>
                                                )}
                                                {s.status === 'cancelled' && (
                                                    <span className="text-red-500 text-xs ml-1">[휴강]</span>
                                                )}
                                            </span>
                                            <span className="text-muted-foreground text-xs">{s.classroom_name}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-6">
                    {/* Info Cards */}
                    <Card>
                        <CardHeader className="py-3"><CardTitle className="text-sm font-medium">연락처 및 정보</CardTitle></CardHeader>
                        <CardContent className="space-y-2 text-sm">
                            <div className="flex justify-between"><span className="text-muted-foreground">전화번호</span> <span>{instructor.phone || '-'}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">시급</span> <span className="font-semibold">₩{instructor.hourly_rate?.toLocaleString() || '-'}</span></div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="py-3"><CardTitle className="text-sm font-medium">메모</CardTitle></CardHeader>
                        <CardContent className="text-sm">
                            <div className="whitespace-pre-wrap min-h-[80px] text-foreground">{instructor.notes || '-'}</div>
                        </CardContent>
                    </Card>
                </div>

                {/* Salary Estimate */}
                <Card className={cn("border-l-4", salaryData ? "border-l-green-500" : "border-l-muted")}>
                    <CardHeader className="py-3 pb-2"><CardTitle className="text-base flex justify-between">
                        <span>월간 급여 예상 ({currentMonth}월)</span>
                        {salaryData && <span className="text-green-600">₩{Math.round(salaryData.estimatedSalary).toLocaleString()}</span>}
                    </CardTitle></CardHeader>
                    <CardContent className="text-sm pb-3">
                        {loading ? <Skeleton className="h-4 w-1/2" /> : salaryData ? (
                            <div className="flex gap-6 text-muted-foreground">
                                <span>총 강의: {salaryData.totalHours.toFixed(1)}시간 ({salaryData.totalMinutes}분)</span>
                                <span>시급 적용: ₩{salaryData.instructor.hourly_rate?.toLocaleString()}</span>
                            </div>
                        ) : (
                            <div className="text-muted-foreground">데이터 없음</div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Simple Lesson Context Menu */}
            <ContextMenu
                open={!!lessonContextMenu}
                x={lessonContextMenu?.x ?? 0}
                y={lessonContextMenu?.y ?? 0}
                onClose={closeLessonContextMenu}
            >
                <ContextMenuItem
                    icon={<Edit className="w-4 h-4" />}
                    label="수업 편집"
                    onClick={() => {
                        if (lessonContextMenu) {
                            onLessonEdit?.(lessonContextMenu.lessonId);
                        }
                        closeLessonContextMenu();
                    }}
                />
            </ContextMenu>

            {/* 삭제 확인 다이얼로그 */}
            <ConfirmDialog
                open={isDeleteDialogOpen}
                onOpenChange={setIsDeleteDialogOpen}
                title="강사 삭제"
                description={`'${instructor.name}' 강사를 정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`}
                confirmLabel="삭제"
                cancelLabel="취소"
                variant="destructive"
                onConfirm={onDelete}
            />
        </div>
    );
}
