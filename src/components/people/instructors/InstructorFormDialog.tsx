import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { User, CreditCard, FileText } from 'lucide-react';
import { emitDataChange } from '../../../core/events';
import type { Instructor } from '../../../core/types';

interface InstructorFormDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instructor?: Instructor;
    onSuccess: () => void;
}

// 섹션 헤더 컴포넌트
function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
    return (
        <div className="flex items-center gap-2 pt-4 pb-2">
            <Icon className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-base">{title}</h3>
        </div>
    );
}

export function InstructorFormDialog({ open, onOpenChange, instructor, onSuccess }: InstructorFormDialogProps) {
    const isEdit = !!instructor;
    const [formData, setFormData] = useState<Partial<Instructor>>({});

    useEffect(() => {
        if (open) {
            if (instructor) {
                setFormData({ ...instructor });
            } else {
                setFormData({
                    status: 'active',
                    hire_date: new Date().toISOString().split('T')[0]
                });
            }
        }
    }, [open, instructor]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const api = window.api;
            const payload = { ...formData };
            if (!payload.name) { toast.error('이름을 입력해주세요.'); return; }

            let res;
            if (isEdit && instructor) {
                res = await api.instructors.update({ ...payload, id: instructor.id });
            } else {
                res = await api.instructors.create(payload);
            }

            if (res.success) {
                toast.success('저장되었습니다.');
                onOpenChange(false);
                onSuccess();
                emitDataChange('instructors');
            } else {
                toast.error(res.error instanceof Error ? res.error.message : '실패');
            }
        } catch (error) {
            toast.error('오류 발생');
        }
    };

    const handleChange = (field: keyof Instructor, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    // 공통 Input 스타일 (크기 확대)
    const inputClassName = "h-11 text-base";

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-xl">{isEdit ? '강사 수정' : '강사 추가'}</DialogTitle>
                    <DialogDescription>강사 정보를 입력하세요.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-2 py-2">
                    {/* 📌 기본 정보 */}
                    <SectionHeader icon={User} title="기본 정보" />
                    <div className="grid grid-cols-2 gap-4 pl-7">
                        <div className="space-y-2">
                            <label className="text-sm font-bold">
                                이름 <span className="text-red-500">*</span>
                            </label>
                            <Input
                                className={inputClassName}
                                value={formData.name || ''}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('name', e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">전화번호</label>
                            <Input
                                className={inputClassName}
                                type="tel"
                                value={formData.phone || ''}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('phone', e.target.value)}
                            />
                        </div>
                    </div>

                    <Separator className="my-4" />

                    {/* 💳 급여 정보 */}
                    <SectionHeader icon={CreditCard} title="급여 정보" />
                    <div className="grid grid-cols-2 gap-4 pl-7">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">시급 (원)</label>
                            <Input
                                className={inputClassName}
                                type="number"
                                value={formData.hourly_rate || ''}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('hourly_rate', Number(e.target.value))}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">입사일</label>
                            <Input
                                className={inputClassName}
                                type="date"
                                value={formData.hire_date || ''}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('hire_date', e.target.value)}
                            />
                        </div>
                    </div>

                    <Separator className="my-4" />

                    {/* 📝 메모 */}
                    <SectionHeader icon={FileText} title="메모" />
                    <div className="pl-7">
                        <Input
                            className={inputClassName}
                            value={formData.notes || ''}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('notes', e.target.value)}
                            placeholder="메모를 입력하세요"
                        />
                    </div>

                    <DialogFooter className="pt-6">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
                        <Button type="submit" className="px-8">저장</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
