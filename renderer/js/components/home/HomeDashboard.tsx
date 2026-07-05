import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import * as api from '../../core/api';
import type { ScheduleLesson, Classroom, TodayLessonWithStudents, EnrolledStudentInfo } from '../../core/types';
import { ChevronDown, ChevronUp, Users } from 'lucide-react';
import { cn } from '../../lib/utils';
import { MonthCalendar } from './MonthCalendar';

export interface HomeDashboardProps {
    onNavigate: (page: string) => void;
}

export function HomeDashboard({ onNavigate }: HomeDashboardProps) {
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [monthlyLessons, setMonthlyLessons] = useState<ScheduleLesson[]>([]);

    // 선택된 날짜의 수업만 관리하는 상태는 이제 derived state로 처리
    const [loading, setLoading] = useState(true);
    const [expandedLessons, setExpandedLessons] = useState<Set<number>>(new Set());

    // 수업의 학생 정보를 담을 맵 (lessonId -> students)
    const [lessonStudentsMap, setLessonStudentsMap] = useState<Record<number, EnrolledStudentInfo[]>>({});
    const [classroomsMap, setClassroomsMap] = useState<Map<number, Classroom>>(new Map());

    useEffect(() => {
        loadMonthData(currentMonth);
    }, [currentMonth]);

    // 선택된 날짜가 변경될 때마다 해당 날짜 수업들의 학생 정보를 로드
    useEffect(() => {
        if (monthlyLessons.length > 0) {
            loadStudentDataForDate(selectedDate);
        }
    }, [selectedDate, monthlyLessons]);

    const loadMonthData = async (date: Date) => {
        setLoading(true);
        try {
            const year = date.getFullYear();
            const month = date.getMonth();
            // 달력 그리드에 표시되는 이전/다음 달 날짜까지 포함하기 위해 여유 있게 조회
            // (대략 앞뒤로 7일씩 여유를 둠)
            const startDate = new Date(year, month, 1);
            startDate.setDate(startDate.getDate() - 7);

            const endDate = new Date(year, month + 1, 0);
            endDate.setDate(endDate.getDate() + 7);

            // 로컬 날짜 문자열 변환 (YYYY-MM-DD)
            const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

            const [schedulesResult, classroomsResult] = await Promise.all([
                api.listScheduleLessons(fmt(startDate), fmt(endDate)),
                api.listClassrooms(),
            ]);

            if (!schedulesResult.success || !classroomsResult.success) {
                console.error('Failed to load data');
                return;
            }

            setMonthlyLessons(schedulesResult.data);

            const cMap = new Map<number, Classroom>();
            classroomsResult.data.forEach((room) => cMap.set(room.id, room));
            setClassroomsMap(cMap);

        } catch (error) {
            console.error('Failed to load dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadStudentDataForDate = async (date: Date) => {
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const targetLessons = monthlyLessons.filter(l => l.date === dateStr);

        // 이미 로드된 데이터가 있으면 건너뜀 (Optimization)
        const lessonsToLoad = targetLessons.filter(l => !lessonStudentsMap[l.lessonId]);

        if (lessonsToLoad.length === 0) return;

        const lessonIds = lessonsToLoad.map(l => l.lessonId);

        // 배치 API로 한 번에 조회 (N+1 문제 해결)
        const result = await api.listEnrollmentsByLessonIds(lessonIds);

        if (!result.success) {
            console.error('Failed to load students for lessons:', result.error);
            return;
        }

        // 결과를 EnrolledStudentInfo 형태로 변환
        const newStudentsMap: Record<number, EnrolledStudentInfo[]> = {};

        for (const [lessonIdStr, enrollments] of Object.entries(result.data)) {
            const lessonId = Number(lessonIdStr);
            newStudentsMap[lessonId] = enrollments.map(item => ({
                id: item.student_id,
                name: item.student_name || '-',
                schoolGrade: formatSchoolGradeFromRaw(item.school_type, item.grade),
                phone: item.phone || null,
                parentPhone: item.parent_phone || null,
            }));
        }

        setLessonStudentsMap(prev => ({ ...prev, ...newStudentsMap }));
    };

    // 학교 학년 표시 포맷 (raw 데이터용)
    function formatSchoolGradeFromRaw(schoolType: string | null, grade: string | null): string {
        if (!schoolType || !grade) return '-';
        const schoolNames: Record<string, string> = {
            elementary: '초',
            middle: '중',
            high: '고',
        };
        return `${schoolNames[schoolType] || ''}${grade}`;
    }

    const handleNavigateToTimetable = () => {
        onNavigate('classrooms');
    };

    const toggleExpand = (lessonId: number) => {
        setExpandedLessons((prev) => {
            const next = new Set(prev);
            if (next.has(lessonId)) {
                next.delete(lessonId);
            } else {
                next.add(lessonId);
            }
            return next;
        });
    };

    // 현재 선택된 날짜의 수업 목록 필터링 및 가공
    const selectedDateStr = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`;
    const dayLessons: TodayLessonWithStudents[] = monthlyLessons
        .filter(l => l.date === selectedDateStr)
        .map(schedule => ({
            id: schedule.id,
            lessonId: schedule.lessonId,
            title: schedule.title,
            instructor: schedule.instructor,
            startTime: schedule.startTime,
            endTime: schedule.endTime,
            classroomName: classroomsMap.get(schedule.classroomId)?.name || '-',
            status: schedule.status || 'scheduled',
            students: lessonStudentsMap[schedule.lessonId] || [],
        }))
        .sort((a, b) => a.startTime.localeCompare(b.startTime));

    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const selectedDateLabel = `${selectedDate.getFullYear()}년 ${selectedDate.getMonth() + 1}월 ${selectedDate.getDate()}일 (${dayNames[selectedDate.getDay()]})`;

    // 오늘로 돌아가기
    const handleBackToToday = () => {
        const today = new Date();
        setCurrentMonth(today);
        setSelectedDate(today);
    };

    return (
        <div className="container p-6 space-y-6 max-w-5xl mx-auto animation-fade-in">
            {/* 캘린더 섹션: 상단 배치 */}
            <div className="flex flex-col space-y-4">
                <MonthCalendar
                    currentDate={currentMonth}
                    selectedDate={selectedDate}
                    onSelectDate={setSelectedDate}
                    onMonthChange={setCurrentMonth}
                    lessons={monthlyLessons}
                />
            </div>

            {/* 선택된 날짜 수업 목록: 하단 배치 */}
            <Card className="min-h-[400px]">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4 border-b bg-muted/20">
                    <div className="flex flex-col gap-1">
                        <CardTitle className="text-xl font-bold flex items-center gap-2">
                            {selectedDateLabel}
                        </CardTitle>
                        <p className="text-sm text-muted-foreground">
                            {loading ? '일정 로딩 중...' : `총 ${dayLessons.length}개의 수업이 있습니다.`}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={handleBackToToday}>
                            오늘로 이동
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleNavigateToTimetable}>
                            시간표 보기 →
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-6">
                    {loading && dayLessons.length === 0 ? (
                        <div className="space-y-3">
                            <Skeleton className="h-16 w-full" />
                            <Skeleton className="h-16 w-full" />
                            <Skeleton className="h-16 w-full" />
                        </div>
                    ) : dayLessons.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/60 space-y-2">
                            <div className="text-4xl">😴</div>
                            <p>예정된 수업이 없습니다.</p>
                        </div>
                    ) : (
                        dayLessons.map((lesson) => {
                            const isExpanded = expandedLessons.has(lesson.id);
                            const isCancelled = lesson.status === 'cancelled';

                            return (
                                <div
                                    key={lesson.id}
                                    className={cn(
                                        'rounded-xl overflow-hidden transition-all bg-card border shadow-sm hover:shadow-md',
                                        isCancelled && 'opacity-60 bg-muted/30'
                                    )}
                                >
                                    {/* 수업 헤더 */}
                                    <button
                                        type="button"
                                        className="w-full flex items-center justify-between p-4 hover:bg-accent/5 transition-colors text-left border-none bg-transparent cursor-pointer"
                                        onClick={() => toggleExpand(lesson.id)}
                                    >
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3">
                                                <span className={cn(
                                                    'font-medium text-blue-600 tabular-nums text-base',
                                                    isCancelled && 'line-through text-muted-foreground'
                                                )}>
                                                    [{lesson.startTime} - {lesson.endTime}]
                                                </span>
                                                <span className={cn(
                                                    'font-bold text-lg',
                                                    isCancelled && 'line-through text-muted-foreground'
                                                )}>
                                                    {lesson.title}
                                                </span>
                                                {isCancelled && (
                                                    <span className="text-xs bg-red-100 text-red-600 px-2.5 py-0.5 rounded-full font-medium">
                                                        휴강
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground">
                                                <span className="flex items-center gap-1">
                                                    👨‍🏫 {lesson.instructor || '-'}
                                                </span>
                                                <span className="w-0.5 h-0.5 rounded-full bg-muted-foreground/50" />
                                                <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium bg-secondary/50 text-secondary-foreground">
                                                    {lesson.classroomName}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground bg-secondary/30 px-2 py-1 rounded-md">
                                                <Users className="h-3.5 w-3.5" />
                                                <span className="font-medium">{lesson.students.length}명</span>
                                            </div>
                                            {isExpanded ? (
                                                <ChevronUp className="h-5 w-5 text-muted-foreground" />
                                            ) : (
                                                <ChevronDown className="h-5 w-5 text-muted-foreground" />
                                            )}
                                        </div>
                                    </button>

                                    {/* 학생 목록 (펼침) */}
                                    {isExpanded && (
                                        <div className="border-t border-border/50 bg-muted/20 p-4 animate-in slide-in-from-top-1 duration-200">
                                            <h4 className="text-sm font-medium mb-3 text-muted-foreground flex items-center gap-2">
                                                <Users className="w-4 h-4" />
                                                수강 학생 목록 ({lesson.students.length}명)
                                            </h4>
                                            {lesson.students.length === 0 ? (
                                                <p className="text-sm text-muted-foreground pl-1">
                                                    등록된 학생이 없습니다.
                                                </p>
                                            ) : (
                                                <div className="bg-background rounded-lg border overflow-hidden">
                                                    <table className="w-full text-sm">
                                                        <thead className="bg-muted/50">
                                                            <tr>
                                                                <th className="text-left py-2.5 px-4 font-medium text-muted-foreground w-[25%]">이름</th>
                                                                <th className="text-left py-2.5 px-4 font-medium text-muted-foreground w-[20%]">학교/학년</th>
                                                                <th className="text-left py-2.5 px-4 font-medium text-muted-foreground w-[27.5%]">학생 연락처</th>
                                                                <th className="text-left py-2.5 px-4 font-medium text-muted-foreground w-[27.5%]">학부모 연락처</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y">
                                                            {lesson.students.map((student) => (
                                                                <tr key={student.id} className="hover:bg-muted/50 transition-colors">
                                                                    <td className="py-2.5 px-4 font-medium">{student.name}</td>
                                                                    <td className="py-2.5 px-4 text-muted-foreground">{student.schoolGrade}</td>
                                                                    <td className="py-2.5 px-4 tabular-nums text-muted-foreground">{student.phone || '-'}</td>
                                                                    <td className="py-2.5 px-4 tabular-nums text-muted-foreground">{student.parentPhone || '-'}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
