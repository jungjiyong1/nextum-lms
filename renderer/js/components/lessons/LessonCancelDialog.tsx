import React, { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import * as api from '../../core/api';

interface LessonCancelDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    scheduleId: number;
    lessonId: number;
    lessonTitle: string;
    date: string;
    startTime: string;
    endTime: string;
    onSuccess: () => void;
}

export function LessonCancelDialog({
    open,
    onOpenChange,
    scheduleId,
    lessonId,
    lessonTitle,
    date,
    startTime,
    endTime,
    onSuccess,
}: LessonCancelDialogProps) {
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);

    const handleCancel = async () => {
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

        const result = await api.cancelSchedule(actualScheduleId, reason || undefined);
        if (result.success) {
            toast.success('휴강 처리되었습니다.');
            onSuccess();
            onOpenChange(false);
            setReason('');
        } else {
            console.error('Failed to cancel schedule:', result.error);
            toast.error('휴강 처리에 실패했습니다: ' + result.error.message);
        }
        setSaving(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                    <DialogTitle>휴강 처리</DialogTitle>
                </DialogHeader>

                <div className="py-4 space-y-4">
                    <div className="p-4 bg-muted/50 rounded-lg text-sm">
                        <p className="font-medium">{lessonTitle}</p>
                        <p className="text-muted-foreground mt-1">{date}</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="cancel-reason">휴강 사유 (선택)</Label>
                        <Textarea
                            id="cancel-reason"
                            rows={2}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="예: 강사 개인 사정, 공휴일 등"
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        취소
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={handleCancel}
                        disabled={saving}
                    >
                        {saving ? '처리 중...' : '휴강 처리'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
