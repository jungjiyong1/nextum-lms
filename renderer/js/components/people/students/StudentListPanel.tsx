import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Skeleton } from '@/components/ui/skeleton';
import { Search } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { Student } from '../../../core/types';

interface StudentListPanelProps {
    students: Student[];
    selectedId: number | null;
    onSelect: (student: Student) => void;
    loading: boolean;
}

const ITEM_HEIGHT = 76; // Fixed height for each student card

export function StudentListPanel({ students, selectedId, onSelect, loading }: StudentListPanelProps) {
    const parentRef = useRef<HTMLDivElement>(null);

    const virtualizer = useVirtualizer({
        count: students.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => ITEM_HEIGHT,
        overscan: 5,
    });

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

    if (loading) {
        return (
            <div className="w-1/3 min-w-[300px] overflow-y-auto border-r bg-muted/10 p-4">
                <div className="space-y-3">
                    {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 w-full" />)}
                </div>
            </div>
        );
    }

    if (students.length === 0) {
        return (
            <div className="w-1/3 min-w-[300px] overflow-y-auto border-r bg-muted/10 p-4">
                <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
                    <Search className="mb-2 h-10 w-10 opacity-20" />
                    <p>학생이 없습니다.</p>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={parentRef}
            className="w-1/3 min-w-[300px] overflow-y-auto border-r bg-muted/10 p-4"
        >
            <div
                style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                }}
            >
                {virtualizer.getVirtualItems().map(virtualRow => {
                    const student = students[virtualRow.index];
                    return (
                        <div
                            key={student.id}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: `${virtualRow.size}px`,
                                transform: `translateY(${virtualRow.start}px)`,
                            }}
                        >
                            <div
                                onClick={() => onSelect(student)}
                                className={cn(
                                    "cursor-pointer rounded-lg border p-3 hover:bg-accent transition-colors mb-2",
                                    selectedId === student.id ? "border-primary bg-accent ring-1 ring-primary" : "bg-card"
                                )}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
                                            {getStudentName(student).charAt(0)}
                                        </div>
                                        <div>
                                            <div className="font-semibold">{getStudentName(student)}</div>
                                            <div className="text-xs text-muted-foreground flex gap-1 items-center">
                                                {student.school_type && (
                                                    <span className="bg-muted py-0.5 rounded text-[10px]">
                                                        {schoolTypeLabels[student.school_type] || student.school_type} {student.grade}학년
                                                    </span>
                                                )}
                                                {/* {student.monthly_tuition && (
                                                    <span className="text-green-600 font-medium ml-1">
                                                        ₩{student.monthly_tuition.toLocaleString()}
                                                    </span>
                                                )} */}
                                            </div>
                                        </div>
                                    </div>
                                    <span className={cn(
                                        "text-xs px-2 py-0.5 rounded-full font-medium",
                                        student.status === 'active' ? "bg-green-100 text-green-700" :
                                            student.status === 'on_leave' ? "bg-yellow-100 text-yellow-700" :
                                                "bg-red-100 text-red-700"
                                    )}>
                                        {statusLabels[student.status] || student.status}
                                    </span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
