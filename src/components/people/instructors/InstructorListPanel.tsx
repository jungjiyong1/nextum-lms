import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '../../../lib/utils';
import type { Instructor } from '../../../core/types';

interface InstructorListPanelProps {
    instructors: Instructor[];
    selectedId: number | null;
    onSelect: (instructor: Instructor) => void;
    loading: boolean;
}

const ITEM_HEIGHT = 88; // Fixed height for each instructor card

export function InstructorListPanel({ instructors, selectedId, onSelect, loading }: InstructorListPanelProps) {
    const parentRef = useRef<HTMLDivElement>(null);

    const virtualizer = useVirtualizer({
        count: instructors.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => ITEM_HEIGHT,
        overscan: 5,
    });

    if (loading) {
        return (
            <div className="w-1/3 min-w-[320px] overflow-y-auto border-r bg-muted/10 p-4">
                <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
            </div>
        );
    }

    if (instructors.length === 0) {
        return (
            <div className="w-1/3 min-w-[320px] overflow-y-auto border-r bg-muted/10 p-4">
                <div className="text-center text-muted-foreground py-10">강사가 없습니다.</div>
            </div>
        );
    }

    return (
        <div
            ref={parentRef}
            className="w-1/3 min-w-[320px] overflow-y-auto border-r bg-muted/10 p-4"
        >
            <div
                style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                }}
            >
                {virtualizer.getVirtualItems().map(virtualRow => {
                    const inst = instructors[virtualRow.index];
                    return (
                        <div
                            key={inst.id}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: `${virtualRow.size}px`,
                                transform: `translateY(${virtualRow.start}px)`,
                            }}
                        >
                            <Card
                                className={cn(
                                    "cursor-pointer transition-all hover:shadow-md mb-3",
                                    selectedId === inst.id ? "border-primary ring-1 ring-primary bg-accent/50" : ""
                                )}
                                onClick={() => onSelect(inst)}
                            >
                                <div className="p-4 flex justify-between items-start">
                                    <div className="flex gap-3">
                                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                                            {(inst.name || '').charAt(0)}
                                        </div>
                                        <div>
                                            <div className="font-semibold">{inst.name}</div>
                                            {inst.hourly_rate && (
                                                <div className="text-xs text-muted-foreground mt-1">
                                                    ₩{inst.hourly_rate.toLocaleString()}/시간
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
