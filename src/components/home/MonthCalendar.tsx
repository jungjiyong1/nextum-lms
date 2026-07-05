import React, { useMemo } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ScheduleLesson } from '../../core/types';

interface LessonDayInfo {
    count: number;
    hasCancelled: boolean;
}

interface MonthCalendarProps {
    currentDate: Date;
    selectedDate: Date;
    onSelectDate: (date: Date) => void;
    onMonthChange: (date: Date) => void;
    lessons: ScheduleLesson[]; // 월간 전체 수업 데이터
}

export function MonthCalendar({
    currentDate,
    selectedDate,
    onSelectDate,
    onMonthChange,
    lessons
}: MonthCalendarProps) {
    // 1. 달력 그리드 계산 (월요일 시작)
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth(); // 0-based

    // 해당 월의 1일
    const firstDayOfMonth = new Date(year, month, 1);
    // 해당 월의 마지막 날
    const lastDayOfMonth = new Date(year, month + 1, 0);

    // 달력 시작 날짜 (첫 주 월요일 찾기)
    // getDay(): 0(일), 1(월), ... 6(토)
    // 월요일(1)이 시작이므로, 1일의 요일에서 1을 빼서 이전 달 날짜를 계산
    // 만약 1일이 일요일(0)이면 -1 -> 6일 전, 월요일(1)이면 0 -> 당일
    let startDayOffset = firstDayOfMonth.getDay() - 1;
    if (startDayOffset < 0) startDayOffset = 6; // 일요일인 경우 6일 전(월요일)부터 시작

    const startDate = new Date(year, month, 1 - startDayOffset);

    // 6주(42일) 고정으로 렌더링하면 높이가 일정해서 깔끔함
    const calendarDays: Date[] = [];
    for (let i = 0; i < 42; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        calendarDays.push(d);
    }

    // 날짜 비교 유틸
    const isSameDay = (d1: Date, d2: Date) => {
        return d1.getFullYear() === d2.getFullYear() &&
            d1.getMonth() === d2.getMonth() &&
            d1.getDate() === d2.getDate();
    };

    const isToday = (d: Date) => isSameDay(d, new Date());
    const isCurrentMonth = (d: Date) => d.getMonth() === month;

    // 네비게이션 핸들러
    const handlePrevMonth = () => {
        onMonthChange(new Date(year, month - 1, 1));
    };

    const handleNextMonth = () => {
        onMonthChange(new Date(year, month + 1, 1));
    };

    const handleToday = () => {
        const today = new Date();
        onMonthChange(today);
        onSelectDate(today);
    };

    // 요일 헤더 (월요일 시작)
    const weekDays = ['월', '화', '수', '목', '금', '토', '일'];

    // 날짜별 수업 정보 맵 - 한 번만 계산 후 O(1) 조회
    // 기존: 42칸 × 2번 필터 = O(84 × lessons)
    // 개선: O(lessons) 1회 순회 후 O(1) 조회
    const lessonInfoMap = useMemo(() => {
        const map = new Map<string, LessonDayInfo>();

        for (const lesson of lessons) {
            const dateStr = lesson.date;
            const existing = map.get(dateStr) || { count: 0, hasCancelled: false };

            if (lesson.status === 'cancelled') {
                existing.hasCancelled = true;
            } else {
                existing.count += 1;
            }

            map.set(dateStr, existing);
        }

        return map;
    }, [lessons]);

    // 날짜별 수업 집계 - O(1) 조회
    const getLessonInfo = (date: Date): LessonDayInfo => {
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        return lessonInfoMap.get(dateStr) || { count: 0, hasCancelled: false };
    };

    return (
        <Card className="border-none shadow-sm bg-background">
            <CardContent className="p-4">
                {/* 헤더 */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <Button variant="outline" size="default" onClick={handleToday} className="h-9 px-3 text-sm">
                            오늘로 이동
                        </Button>
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            {year}년 {month + 1}월
                        </h2>
                    </div>
                    <div className="flex items-center gap-1">
                        <Button variant="outline" size="icon" onClick={handlePrevMonth} className="h-9 w-9">
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="icon" onClick={handleNextMonth} className="h-9 w-9">
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* 요일 헤더 */}
                <div className="grid grid-cols-7 mb-2 text-center border-b pb-2">
                    {weekDays.map((day, idx) => (
                        <div
                            key={day}
                            className={cn(
                                "text-sm font-semibold text-muted-foreground",
                                idx === 5 && "text-blue-600", // 토요일
                                idx === 6 && "text-red-600"   // 일요일
                            )}
                        >
                            {day}
                        </div>
                    ))}
                </div>

                {/* 날짜 그리드 */}
                <div className="grid grid-cols-7 gap-1">
                    {calendarDays.map((date, idx) => {
                        const { count, hasCancelled } = getLessonInfo(date);
                        const isSelected = isSameDay(date, selectedDate);
                        const isThisMonth = isCurrentMonth(date);
                        const dayOfWeek = (date.getDay() + 6) % 7; // 0(월)~6(일)로 변환
                        const today = isToday(date);

                        return (
                            <button
                                key={idx}
                                onClick={() => onSelectDate(date)}
                                className={cn(
                                    // Base styles + positioning for hover z-index
                                    "relative flex flex-col items-center justify-start min-h-[72px] rounded-lg p-1.5",
                                    // Animations & transitions
                                    "transition-all duration-150 ease-out",
                                    // Focus ring matching Button component  
                                    "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                    "appearance-none border-0 cursor-pointer",
                                    // Month visibility
                                    !isThisMonth && "opacity-30 bg-muted/20 cursor-default",
                                    // Selected state
                                    isSelected && "bg-primary/10 shadow-md ring-2 ring-primary/30 scale-[1.02] z-10",
                                    // Default + Hover state (combined) - using slate colors for visible change
                                    !isSelected && isThisMonth && "bg-white hover:bg-slate-100 hover:shadow hover:scale-[1.03] hover:z-10 active:scale-[0.97] active:bg-slate-200",
                                    // Today highlight (not selected)
                                    today && !isSelected && "bg-primary/5 hover:bg-primary/15"
                                )}
                            >
                                <div className="w-full flex justify-center mb-1">
                                    <span className={cn(
                                        "text-base font-bold h-7 w-7 flex items-center justify-center rounded-full transition-transform",
                                        today && "bg-primary text-primary-foreground shadow-sm",
                                        !today && dayOfWeek === 5 && "text-blue-600", // 토요일
                                        !today && dayOfWeek === 6 && "text-red-600",  // 일요일
                                        !today && isSelected && "text-primary"
                                    )}>
                                        {date.getDate()}
                                    </span>
                                </div>

                                {/* 인디케이터 영역 */}
                                <div className="flex flex-col gap-0.5 items-center w-full">
                                    {count > 0 && (
                                        <div className={cn(
                                            "flex items-center rounded-full px-1.5 py-0.5 transition-colors",
                                            isSelected ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary"
                                        )}>
                                            <span className="text-xs font-bold">{count}개</span>
                                        </div>
                                    )}
                                    {hasCancelled && (
                                        <span className="text-[10px] font-bold text-red-500">
                                            휴강
                                        </span>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}

