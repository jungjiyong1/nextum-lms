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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { User, Users, GraduationCap, CreditCard, FileText } from 'lucide-react';
import { emitDataChange } from '../../../core/events';
import type { Student } from '../../../core/types';

interface StudentFormDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    student?: Student | null;
    onSuccess: () => void;
}

// 통합 학년 옵션
const GRADE_OPTIONS = [
    { value: 'elementary-1', label: '초등학교 1학년', type: 'elementary', grade: 1 },
    { value: 'elementary-2', label: '초등학교 2학년', type: 'elementary', grade: 2 },
    { value: 'elementary-3', label: '초등학교 3학년', type: 'elementary', grade: 3 },
    { value: 'elementary-4', label: '초등학교 4학년', type: 'elementary', grade: 4 },
    { value: 'elementary-5', label: '초등학교 5학년', type: 'elementary', grade: 5 },
    { value: 'elementary-6', label: '초등학교 6학년', type: 'elementary', grade: 6 },
    { value: 'middle-1', label: '중학교 1학년', type: 'middle', grade: 1 },
    { value: 'middle-2', label: '중학교 2학년', type: 'middle', grade: 2 },
    { value: 'middle-3', label: '중학교 3학년', type: 'middle', grade: 3 },
    { value: 'high-1', label: '고등학교 1학년', type: 'high', grade: 1 },
    { value: 'high-2', label: '고등학교 2학년', type: 'high', grade: 2 },
    { value: 'high-3', label: '고등학교 3학년', type: 'high', grade: 3 },
];

// 섹션 헤더 컴포넌트
function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
    return (
        <div className="flex items-center gap-2 pt-4 pb-2">
            <Icon className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-base">{title}</h3>
        </div>
    );
}

export function StudentFormDialog({ open, onOpenChange, student, onSuccess }: StudentFormDialogProps) {
    const isEdit = !!student;
    const [formData, setFormData] = useState<Partial<Student>>({});

    // 통합 학년 값 계산
    const getGradeValue = () => {
        if (formData.school_type && formData.grade) {
            return `${formData.school_type}-${formData.grade}`;
        }
        return 'elementary-1';
    };

    // 통합 학년 변경 핸들러
    const handleGradeChange = (value: string) => {
        const option = GRADE_OPTIONS.find(opt => opt.value === value);
        if (option) {
            setFormData(prev => ({
                ...prev,
                school_type: option.type as 'elementary' | 'middle' | 'high',
                grade: option.grade
            }));
        }
    };

    useEffect(() => {
        if (open) {
            if (student) {
                setFormData({ ...student });
            } else {
                setFormData({
                    status: 'active',
                    school_type: 'elementary',
                    grade: 1,
                    enrollment_date: new Date().toISOString().split('T')[0],
                    payment_cycle_day: 1
                });
            }
        }
    }, [open, student]);

    const handleChange = (field: keyof Student, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const api = window.api;
            const payload = { ...formData };

            if (!payload.name) {
                toast.error('이름을 입력해주세요.');
                return;
            }

            let result;
            if (isEdit && student) {
                const updatePayload = { ...payload, id: student.id };
                result = await api.students.update(updatePayload);
            } else {
                result = await api.students.create(payload);
            }

            if (result.success) {
                toast.success('저장되었습니다.');
                onOpenChange(false);
                onSuccess();
                emitDataChange('students');
            } else {
                const errorMessage = result.error ? String(result.error) : '';
                toast.error(errorMessage || '저장 실패');
            }
        } catch (error) {
            console.error(error);
            toast.error('오류 발생');
        }
    };

    // 공통 Input 스타일 (크기 확대)
    const inputClassName = "h-11 text-base";
    const selectTriggerClassName = "h-11 text-base";

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-xl">{isEdit ? '학생 수정' : '학생 추가'}</DialogTitle>
                    <DialogDescription>학생 정보를 입력하세요.</DialogDescription>
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
                            <label className="text-sm font-medium">상태</label>
                            <Select value={formData.status || 'active'} onValueChange={(v: string) => handleChange('status', v)}>
                                <SelectTrigger className={selectTriggerClassName}><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="active">재원</SelectItem>
                                    <SelectItem value="on_leave">휴원</SelectItem>
                                    <SelectItem value="dropped">퇴원</SelectItem>
                                </SelectContent>
                            </Select>
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
                        <div className="space-y-2">
                            <label className="text-sm font-medium">생년월일</label>
                            <Input
                                className={inputClassName}
                                type="date"
                                value={formData.date_of_birth || ''}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('date_of_birth', e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">등록일</label>
                            <Input
                                className={inputClassName}
                                type="date"
                                value={formData.enrollment_date || ''}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('enrollment_date', e.target.value)}
                            />
                        </div>
                    </div>

                    <Separator className="my-4" />

                    {/* 👪 학부모 정보 */}
                    <SectionHeader icon={Users} title="학부모 정보" />
                    <div className="grid grid-cols-2 gap-4 pl-7">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">이름</label>
                            <Input
                                className={inputClassName}
                                value={formData.parent_name || ''}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('parent_name', e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">연락처</label>
                            <Input
                                className={inputClassName}
                                type="tel"
                                value={formData.parent_phone || ''}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('parent_phone', e.target.value)}
                            />
                        </div>
                    </div>

                    <Separator className="my-4" />

                    {/* 🏫 학교 정보 */}
                    <SectionHeader icon={GraduationCap} title="학교 정보" />
                    <div className="pl-7">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">학년</label>
                            <Select value={getGradeValue()} onValueChange={handleGradeChange}>
                                <SelectTrigger className={selectTriggerClassName}>
                                    <SelectValue placeholder="학년 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                    {/* 초등학교 */}
                                    {GRADE_OPTIONS.filter(o => o.type === 'elementary').map(opt => (
                                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                    ))}
                                    <Separator className="my-1" />
                                    {/* 중학교 */}
                                    {GRADE_OPTIONS.filter(o => o.type === 'middle').map(opt => (
                                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                    ))}
                                    <Separator className="my-1" />
                                    {/* 고등학교 */}
                                    {GRADE_OPTIONS.filter(o => o.type === 'high').map(opt => (
                                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <Separator className="my-4" />

                    {/* 💳 결제 정보 */}
                    <SectionHeader icon={CreditCard} title="결제 정보" />
                    <div className="grid grid-cols-2 gap-4 pl-7">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">월 수강료</label>
                            <Input
                                className={inputClassName}
                                type="number"
                                value={formData.monthly_tuition || ''}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('monthly_tuition', Number(e.target.value))}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">결제일 (매월)</label>
                            <Input
                                className={inputClassName}
                                type="number"
                                min="1"
                                max="31"
                                value={formData.payment_cycle_day || ''}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('payment_cycle_day', Number(e.target.value))}
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
