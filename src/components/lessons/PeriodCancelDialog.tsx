import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { toast } from 'sonner';
import * as api from '../../core/api';

interface PeriodCancelDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    lessonId: number;
    lessonTitle: string;
    instructor: string;
    dayOfWeek: string;
    onSuccess?: () => void;
}

export function PeriodCancelDialog({
    open,
    onOpenChange,
    lessonId,
    lessonTitle,
    instructor,
    dayOfWeek,
    onSuccess
}: PeriodCancelDialogProps) {
    const today = new Date().toISOString().split('T')[0];
    const [startDate, setStartDate] = useState(today);
    const [endDate, setEndDate] = useState(today);
    const [reason, setReason] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (!startDate || !endDate) {
            toast.error('시작일과 종료일을 입력해주세요.');
            return;
        }
        if (startDate > endDate) {
            toast.error('시작일이 종료일보다 늦을 수 없습니다.');
            return;
        }

        setIsSubmitting(true);
        const result = await api.cancelSchedulesByDateRange(lessonId, startDate, endDate, reason || undefined);
        if (result.success) {
            toast.success(`기간 휴강 처리가 완료되었습니다. (${result.data.count}건)`);
            onOpenChange(false);
            onSuccess?.();
        } else {
            console.error('Failed to cancel period:', result.error);
            toast.error('휴강 처리에 실패했습니다: ' + result.error.message);
        }
        setIsSubmitting(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>기간 휴강 처리</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    {/* 수업 정보 */}
                    <div className="bg-muted/50 rounded-lg p-3">
                        <p className="font-semibold text-base">{lessonTitle}</p>
                        <p className="text-sm text-muted-foreground">
                            매주 {dayOfWeek} · 담당: {instructor}
                        </p>
                    </div>

                    {/* 기간 선택 */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="startDate">시작일</Label>
                            <Input
                                id="startDate"
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="endDate">종료일</Label>
                            <Input
                                id="endDate"
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* 사유 입력 */}
                    <div className="space-y-2">
                        <Label htmlFor="reason">휴강 사유 (선택)</Label>
                        <Textarea
                            id="reason"
                            placeholder="예: 학원 방학 기간"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={2}
                        />
                    </div>

                    <p className="text-sm text-muted-foreground">
                        ※ 해당 기간 내 {dayOfWeek}요일 수업이 모두 휴강 처리됩니다.
                    </p>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                        취소
                    </Button>
                    <Button onClick={handleSubmit} disabled={isSubmitting}>
                        {isSubmitting ? '처리 중...' : '휴강 처리'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
