import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { toast } from 'sonner';
import { useClassroomStore } from '../../stores/classroomStore';

interface MakeupDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    originalScheduleId: number;
    lessonTitle: string;
    originalDate: string;
    originalStartTime: string;
    originalEndTime: string;
    originalClassroomId: number;
    originalInstructorId: number;
    originalInstructor: string;
    onSuccess?: () => void;
}

interface InstructorInfo {
    id: number;
    name: string;
}

export function MakeupDialog({
    open,
    onOpenChange,
    originalScheduleId,
    lessonTitle,
    originalDate,
    originalStartTime,
    originalEndTime,
    originalClassroomId,
    originalInstructorId,
    originalInstructor,
    onSuccess
}: MakeupDialogProps) {
    const { classrooms } = useClassroomStore();
    const [instructors, setInstructors] = useState<InstructorInfo[]>([]);

    // 기본값: 원래 수업 정보
    const [date, setDate] = useState('');
    const [startTime, setStartTime] = useState(originalStartTime);
    const [endTime, setEndTime] = useState(originalEndTime);
    const [classroomId, setClassroomId] = useState<number>(originalClassroomId);
    const [instructorId, setInstructorId] = useState<number>(originalInstructorId);
    const [notes, setNotes] = useState(`${originalDate} 수업 보강`);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // 강사 목록 로드
    useEffect(() => {
        if (open) {
            loadInstructors();
        }
    }, [open]);

    const loadInstructors = async () => {
        try {
            const result = await window.api.instructors.list({ status: 'active' });
            if (!result.success) {
                toast.error('강사 목록을 불러오지 못했습니다.');
                return;
            }

            setInstructors(result.data.map((inst: { id: number; name?: string }) => ({
                id: inst.id,
                name: inst.name || ''
            })));
        } catch (error) {
            console.error('Failed to load instructors:', error);
        }
    };

    useEffect(() => {
        if (open) {
            // 다이얼로그 열릴 때 기본값 설정
            setStartTime(originalStartTime);
            setEndTime(originalEndTime);
            setClassroomId(originalClassroomId);
            setInstructorId(originalInstructorId);
            setNotes(`${originalDate} 수업 보강`);
            setDate('');
        }
    }, [open, originalStartTime, originalEndTime, originalClassroomId, originalInstructorId, originalDate]);

    const handleSubmit = async () => {
        if (!date) {
            toast.error('보강 날짜를 선택해주세요.');
            return;
        }
        if (!startTime || !endTime) {
            toast.error('시간을 입력해주세요.');
            return;
        }

        setIsSubmitting(true);
        try {
            const selectedInstructor = instructors.find((inst) => inst.id === instructorId);
            const result = await window.api.schedules.createMakeup(
                originalScheduleId,
                date,
                startTime,
                endTime,
                classroomId,
                instructorId || undefined,
                selectedInstructor?.name || originalInstructor,
                notes || undefined
            );
            if (result.success) {
                toast.success('보강 수업이 생성되었습니다.');
                onOpenChange(false);
                onSuccess?.();
            } else {
                toast.error(result.error || '보강 생성에 실패했습니다.');
            }
        } catch (error) {
            console.error('Failed to create makeup:', error);
            toast.error('보강 생성에 실패했습니다.');
        } finally {
            setIsSubmitting(false);
        }
    };

    // classrooms를 배열로 변환
    const classroomList = Object.values(classrooms);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>보강 수업 추가</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    {/* 수업 정보 */}
                    <div className="bg-muted/50 rounded-lg p-3">
                        <p className="font-semibold text-base">{lessonTitle}</p>
                        <p className="text-sm text-muted-foreground">
                            담당: {originalInstructor}
                        </p>
                    </div>

                    {/* 보강 날짜 */}
                    <div className="space-y-2">
                        <Label htmlFor="date">보강 날짜</Label>
                        <Input
                            id="date"
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                        />
                    </div>

                    {/* 시간 */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="startTime">시작 시간</Label>
                            <Input
                                id="startTime"
                                type="time"
                                value={startTime}
                                onChange={(e) => setStartTime(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="endTime">종료 시간</Label>
                            <Input
                                id="endTime"
                                type="time"
                                value={endTime}
                                onChange={(e) => setEndTime(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* 강의실 선택 */}
                    <div className="space-y-2">
                        <Label>강의실</Label>
                        <Select
                            value={String(classroomId)}
                            onValueChange={(val) => setClassroomId(Number(val))}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="강의실 선택" />
                            </SelectTrigger>
                            <SelectContent>
                                {classroomList.map((cr) => (
                                    <SelectItem key={cr.id} value={String(cr.id)}>
                                        {cr.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* 담당 강사 */}
                    <div className="space-y-2">
                        <Label>담당 강사</Label>
                        <Select
                            value={String(instructorId)}
                            onValueChange={(val) => setInstructorId(Number(val))}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="강사 선택" />
                            </SelectTrigger>
                            <SelectContent>
                                {instructors.map((inst) => (
                                    <SelectItem key={inst.id} value={String(inst.id)}>
                                        {inst.name} {inst.id === originalInstructorId && '(원래 강사)'}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* 메모 */}
                    <div className="space-y-2">
                        <Label htmlFor="notes">메모</Label>
                        <Textarea
                            id="notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={2}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                        취소
                    </Button>
                    <Button onClick={handleSubmit} disabled={isSubmitting}>
                        {isSubmitting ? '생성 중...' : '보강 추가'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
