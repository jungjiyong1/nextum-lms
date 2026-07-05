import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { toast } from 'sonner';
import * as api from '../../core/api';
import type { Instructor } from '../../core/types';

interface SubstituteDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    scheduleId: number;
    lessonId: number;
    lessonTitle: string;
    date: string;
    startTime: string;
    endTime: string;
    currentInstructor: string;
    currentInstructorId?: number | null;
    onSuccess: () => void;
}

export function SubstituteDialog({
    open,
    onOpenChange,
    scheduleId,
    lessonId,
    lessonTitle,
    date,
    startTime,
    endTime,
    currentInstructor,
    currentInstructorId,
    onSuccess,
}: SubstituteDialogProps) {
    const [instructors, setInstructors] = useState<Instructor[]>([]);
    const [selectedId, setSelectedId] = useState<string>('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (open) {
            api.listInstructors({ status: 'active' }).then(result => {
                if (result.success) {
                    setInstructors(result.data);
                } else {
                    toast.error('강사 목록 로드 실패: ' + result.error.message);
                }
            });
            setSelectedId('');
        }
    }, [open]);

    // Filter out the current instructor from the list
    const availableInstructors = instructors.filter(
        (inst) => inst.id !== currentInstructorId
    );

    const handleSetSubstitute = async () => {
        if (!selectedId) {
            toast.error('대타 강사를 선택해주세요.');
            return;
        }

        const instructor = availableInstructors.find((i) => i.id.toString() === selectedId);
        if (!instructor) {
            toast.error('강사 정보를 찾을 수 없습니다.');
            return;
        }

        const name = instructor.name || '';

        setSaving(true);
        let actualScheduleId = scheduleId;

        // If scheduleId is negative (virtual ID from recurring lesson), create a schedule first
        if (scheduleId < 0) {
            const createResult = await api.createSchedule({
                lesson_id: lessonId,
                date: date,
                start_time: startTime,
                end_time: endTime,
            });
            if (!createResult.success) {
                toast.error('스케줄 생성 실패: ' + createResult.error.message);
                setSaving(false);
                return;
            }
            actualScheduleId = createResult.data.id;
        }

        const result = await api.setSubstituteInstructor(actualScheduleId, instructor.id, name);
        if (result.success) {
            toast.success(`대타 강사가 ${name}(으)로 설정되었습니다.`);
            onSuccess();
            onOpenChange(false);
        } else {
            console.error('Failed to set substitute:', result.error);
            toast.error('대타 설정에 실패했습니다: ' + result.error.message);
        }
        setSaving(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                    <DialogTitle>대타 강사 설정</DialogTitle>
                </DialogHeader>

                <div className="py-4 space-y-4">
                    <div className="p-4 bg-muted/50 rounded-lg text-sm">
                        <p className="font-medium">{lessonTitle}</p>
                        <p className="text-muted-foreground mt-1">{date}</p>
                        <p className="text-muted-foreground">담당: {currentInstructor || '-'}</p>
                    </div>

                    <div className="space-y-2">
                        <Label>대타 강사 선택</Label>
                        <Select value={selectedId} onValueChange={setSelectedId}>
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="강사를 선택하세요" />
                            </SelectTrigger>
                            <SelectContent>
                                {availableInstructors.map((inst) => (
                                    <SelectItem key={inst.id} value={inst.id.toString()}>
                                        {inst.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        취소
                    </Button>
                    <Button onClick={handleSetSubstitute} disabled={saving || !selectedId}>
                        {saving ? '처리 중...' : '대타 설정'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
