import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { toast } from 'sonner';
import { useAccountingStore } from '../../stores/accountingStore';
import { formatCurrency, formatMonthLabel, formatPercent } from '../../modules/accounting/utils/formatters';
import { calculateWithholding, WithholdingType } from '../../modules/accounting/utils/taxCalculations';
import { emitDataChange, onDataChange } from '../../core/events';
import { Check, Clock, DollarSign } from 'lucide-react';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../../lib/utils';

interface PayrollRecord {
    id: number;
    instructor_id: number | null;
    recipient_name: string;
    year_month: string;
    payment_date: string;
    gross_amount: number;
    withholding_type: WithholdingType;
    withholding_rate: number;
    withholding_tax: number;
    local_tax: number;
    net_amount: number;
    hours_worked: number | null;
    hourly_rate: number | null;
    payment_method: string | null;
    bank_name: string | null;
    account_number: string | null;
    notes: string | null;
}

interface InstructorOption {
    id: number;
    name: string;
    hourly_rate: number | null;
}

interface InstructorEstimate {
    id: number;
    name: string;
    hourly_rate: number | null;
    total_hours: number;
    estimated_salary: number;
    paid: boolean;
    paid_date?: string;
}

export function PayrollManager() {
    const yearMonth = useAccountingStore((state) => state.yearMonth);
    const [payrolls, setPayrolls] = useState<PayrollRecord[]>([]);
    const [estimates, setEstimates] = useState<InstructorEstimate[]>([]);
    const [loading, setLoading] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [quickPayInstructor, setQuickPayInstructor] = useState<InstructorEstimate | null>(null);

    const loadPayroll = useCallback(async () => {
        setLoading(true);
        try {
            const api = window.api;
            const [dataResult, estimateDataResult] = await Promise.all([
                api.accounting.listPayroll(yearMonth),
                api.accounting.instructorEstimates(yearMonth)
            ]);

            if (!dataResult.success) {
                toast.error('급여 목록을 불러오지 못했습니다.');
                setLoading(false);
                return;
            }

            const data = dataResult.data;
            setPayrolls(data);

            // 예상 급여 데이터 가공
            if (estimateDataResult.success && Array.isArray(estimateDataResult.data)) {
                const estimateData = estimateDataResult.data;
                const paidInstructorIds = new Set(
                    payrolls
                        .filter(p => p.instructor_id && p.year_month === yearMonth)
                        .map(p => p.instructor_id)
                );

                const processedEstimates: InstructorEstimate[] = estimateData.map((est: any) => {
                    const instructorId = est.instructor_id || est.id;
                    const paidRecord = data.find(
                        (p: PayrollRecord) => p.instructor_id === instructorId && p.year_month === yearMonth
                    );
                    return {
                        id: instructorId,
                        name: est.instructor_name || est.name || '(이름 없음)',
                        hourly_rate: est.hourly_rate || 0,
                        total_hours: est.total_hours || 0,
                        estimated_salary: est.estimated_salary || 0,
                        paid: !!paidRecord,
                        paid_date: paidRecord?.payment_date
                    };
                });
                setEstimates(processedEstimates);
            }
        } catch (error) {
            console.error('Failed to load payroll list:', error);
            toast.error('급여 목록을 불러오지 못했습니다.');
        } finally {
            setLoading(false);
        }
    }, [yearMonth]);

    useEffect(() => {
        loadPayroll();
    }, [loadPayroll]);

    useEffect(() => {
        const unsubscribe = onDataChange(({ scope }) => {
            if (['accounting', 'instructors', 'lessons', 'general'].includes(scope)) {
                loadPayroll();
            }
        });
        return unsubscribe;
    }, [loadPayroll]);

    const totalGross = payrolls.reduce((sum, p) => sum + p.gross_amount, 0);
    const totalTax = payrolls.reduce((sum, p) => sum + p.withholding_tax + p.local_tax, 0);
    const totalNet = payrolls.reduce((sum, p) => sum + p.net_amount, 0);

    // 예상 급여 통계
    const unpaidEstimates = estimates.filter(e => !e.paid);
    const unpaidTotal = unpaidEstimates.reduce((sum, e) => sum + e.estimated_salary, 0);

    const getWithholdingLabel = (type: WithholdingType) => {
        switch (type) {
            case 'freelance_3.3': return '일반 강사 (3.3%)';
            case 'other_8.8': return '단기 특강 (8.8%)';
            case 'employee': return '근로소득';
            case 'none': default: return '세금 없음';
        }
    };

    const handleQuickPay = (instructor: InstructorEstimate) => {
        setQuickPayInstructor(instructor);
    };

    return (
        <div className="acc-content" id="content-payroll">
            <div className="acc-toolbar">
                <h3>{formatMonthLabel(yearMonth)} 원천징수 급여 관리</h3>
                <Button onClick={() => setIsDialogOpen(true)}>+ 급여 지급</Button>
            </div>

            {/* 로딩 중 Skeleton 표시 */}
            {loading ? (
                <div className="space-y-4">
                    <div className="p-4 bg-blue-50/50 rounded-lg border border-blue-100">
                        <Skeleton className="h-6 w-48 mb-3" />
                        <div className="space-y-2">
                            {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                    </div>
                </div>
            ) : (
                <>
                    {/* 예상 급여 섹션 */}
                    {estimates.length > 0 && (
                        <div className="mb-6 p-4 bg-blue-50/50 rounded-lg border border-blue-100">
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="font-semibold text-lg flex items-center gap-2">
                                    <DollarSign className="w-5 h-5 text-blue-500" />
                                    이번 달 예상 급여 ({estimates.length}명)
                                </h4>
                                {unpaidEstimates.length > 0 && (
                                    <span className="text-sm text-muted-foreground">
                                        📌 미지급 {unpaidEstimates.length}명 · 총 {formatCurrency(unpaidTotal)}
                                    </span>
                                )}
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b">
                                            <th className="text-left py-2 px-3 font-medium text-muted-foreground">강사명</th>
                                            <th className="text-right py-2 px-3 font-medium text-muted-foreground">수업 시간</th>
                                            <th className="text-right py-2 px-3 font-medium text-muted-foreground">시급</th>
                                            <th className="text-right py-2 px-3 font-medium text-muted-foreground">예상 급여</th>
                                            <th className="text-center py-2 px-3 font-medium text-muted-foreground">상태</th>
                                            <th className="text-center py-2 px-3"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {estimates.map((est) => (
                                            <tr key={est.id} className={cn("border-b last:border-0", est.paid && "opacity-60")}>
                                                <td className="py-2 px-3 font-medium">{est.name}</td>
                                                <td className="py-2 px-3 text-right">{est.total_hours.toFixed(1)}h</td>
                                                <td className="py-2 px-3 text-right">{formatCurrency(est.hourly_rate || 0)}</td>
                                                <td className="py-2 px-3 text-right font-medium">{formatCurrency(est.estimated_salary)}</td>
                                                <td className="py-2 px-3 text-center">
                                                    {est.paid ? (
                                                        <span className="inline-flex items-center gap-1 text-green-600 text-xs">
                                                            <Check className="w-3 h-3" />
                                                            지급완료
                                                            {est.paid_date && <span className="text-muted-foreground">({est.paid_date.slice(5)})</span>}
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 text-orange-600 text-xs">
                                                            <Clock className="w-3 h-3" />
                                                            미지급
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="py-2 px-3 text-center">
                                                    {!est.paid && (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => handleQuickPay(est)}
                                                        >
                                                            간편지급
                                                        </Button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    <div className="acc-summary acc-payroll-summary">
                        <div className="acc-summary-row">
                            <div className="acc-summary-item">
                                <span className="acc-label">총 지급액</span>
                                <span className="acc-value blue">{formatCurrency(totalGross)}</span>
                            </div>
                            <div className="acc-summary-item">
                                <span className="acc-label">원천세 합계</span>
                                <span className="acc-value red">{formatCurrency(totalTax)}</span>
                            </div>
                            <div className="acc-summary-item">
                                <span className="acc-label">실수령액 합계</span>
                                <span className="acc-value">{formatCurrency(totalNet)}</span>
                            </div>
                        </div>
                    </div>

                    <p className="acc-info">※ 원천징수 계산은 참고용입니다. 정확한 신고는 세무사와 상담하세요.</p>

                    {payrolls.length === 0 ? (
                        <p className="acc-empty">급여 지급 기록이 없습니다.</p>
                    ) : (
                        <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                            <table className="acc-table">
                                <thead>
                                    <tr>
                                        <th>지급일</th>
                                        <th>수령인</th>
                                        <th>총액</th>
                                        <th>원천세</th>
                                        <th>지방세</th>
                                        <th>실수령액</th>
                                        <th>유형</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {payrolls.map((p) => (
                                        <tr key={p.id}>
                                            <td>{p.payment_date}</td>
                                            <td><strong>{p.recipient_name}</strong></td>
                                            <td>{formatCurrency(p.gross_amount)}</td>
                                            <td className="text-red">{formatCurrency(p.withholding_tax)}</td>
                                            <td className="text-red">{formatCurrency(p.local_tax)}</td>
                                            <td>{formatCurrency(p.net_amount)}</td>
                                            <td>{getWithholdingLabel(p.withholding_type)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            <PayrollDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                onSuccess={() => {
                    loadPayroll();
                    emitDataChange('accounting');
                }}
            />

            <QuickPayDialog
                open={!!quickPayInstructor}
                instructor={quickPayInstructor}
                yearMonth={yearMonth}
                onOpenChange={(open) => !open && setQuickPayInstructor(null)}
                onSuccess={() => {
                    loadPayroll();
                    emitDataChange('accounting');
                    setQuickPayInstructor(null);
                }}
            />
        </div>
    );
}

// 간편 지급 다이얼로그
function QuickPayDialog({
    open,
    instructor,
    yearMonth,
    onOpenChange,
    onSuccess
}: {
    open: boolean;
    instructor: InstructorEstimate | null;
    yearMonth: string;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}) {
    const [withholdingType, setWithholdingType] = useState<WithholdingType>('none'); // 기본값: 세금 없음
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (open) {
            setWithholdingType('none'); // 기본값 리셋
            setDate(new Date().toISOString().split('T')[0]);
        }
    }, [open]);

    if (!instructor) return null;

    const gross = instructor.estimated_salary;
    const preview = calculateWithholding(gross, withholdingType);

    const handleSave = async () => {
        setSaving(true);
        const result = await window.api.accounting.createPayroll({
            instructor_id: instructor.id,
            recipient_name: instructor.name,
            year_month: yearMonth,
            payment_date: date,
            gross_amount: gross,
            withholding_type: withholdingType,
            hours_worked: instructor.total_hours,
            hourly_rate: instructor.hourly_rate,
            payment_method: 'bank_transfer',
            notes: `${yearMonth} 급여 간편 지급`,
        });

        if (result.success) {
            toast.success(`${instructor.name} 강사 급여가 지급되었습니다.`);
            onSuccess();
        } else {
            console.error(result.error);
            toast.error('급여 지급에 실패했습니다.');
        }
        setSaving(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[420px]">
                <DialogHeader>
                    <DialogTitle>{instructor.name} 급여 간편 지급</DialogTitle>
                </DialogHeader>

                <div className="py-4 space-y-4">
                    <p className="text-sm text-muted-foreground">
                        {formatMonthLabel(yearMonth)} 급여를 지급합니다.
                    </p>

                    <div className="p-4 bg-muted/50 rounded-lg space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">수업 시간</span>
                            <span className="font-medium">{instructor.total_hours.toFixed(1)}시간</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">시급</span>
                            <span className="font-medium">{formatCurrency(instructor.hourly_rate || 0)}</span>
                        </div>
                        <div className="border-t my-2"></div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">총 지급액</span>
                            <span className="font-bold text-lg">{formatCurrency(gross)}</span>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>급여 유형</Label>
                        <div className="grid grid-cols-2 gap-2">
                            {[
                                { val: 'freelance_3.3' as const, label: '일반 강사', sub: '3.3%' },
                                { val: 'other_8.8' as const, label: '단기 특강', sub: '8.8%' },
                                { val: 'employee' as const, label: '근로소득', sub: '간이세액' },
                                { val: 'none' as const, label: '세금없음', sub: '' }
                            ].map(opt => (
                                <Button
                                    key={opt.val}
                                    type="button"
                                    variant={withholdingType === opt.val ? "default" : "outline"}
                                    className={cn(
                                        "h-auto py-3 flex-col",
                                        withholdingType === opt.val && "ring-2 ring-primary/20"
                                    )}
                                    onClick={() => setWithholdingType(opt.val)}
                                >
                                    <span className="block font-medium">{opt.label}</span>
                                    {opt.sub && <span className="text-xs opacity-70">({opt.sub})</span>}
                                </Button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 p-3 bg-muted/30 rounded-lg text-sm">
                        <div className="text-center">
                            <span className="block text-muted-foreground text-xs">세금 공제</span>
                            <strong className="text-red-600">{formatCurrency(preview.totalTax)}</strong>
                        </div>
                        <div className="text-center">
                            <span className="block text-muted-foreground text-xs">실수령액</span>
                            <strong className="text-blue-600">{formatCurrency(preview.netAmount)}</strong>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="quick-date">지급일</Label>
                        <Input
                            id="quick-date"
                            type="date"
                            value={date}
                            onChange={e => setDate(e.target.value)}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? '처리 중...' : '지급 완료'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function PayrollDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (open: boolean) => void; onSuccess: () => void }) {
    const [instructors, setInstructors] = useState<InstructorOption[]>([]);
    const [instructorId, setInstructorId] = useState('manual');
    const [recipient, setRecipient] = useState('');
    const [hours, setHours] = useState('');
    const [rate, setRate] = useState('');
    const [gross, setGross] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [method, setMethod] = useState('bank_transfer');
    const [notes, setNotes] = useState('');
    const [withholdingType, setWithholdingType] = useState<WithholdingType>('freelance_3.3');

    useEffect(() => {
        if (open) {
            window.api.instructors.list().then((result: any) => {
                if (result.success) {
                    setInstructors(result.data);
                }
            });
        }
    }, [open]);

    useEffect(() => {
        if (instructorId === 'manual') {
            setRecipient('');
            setRate('');
            setHours('');
        } else {
            const instructor = instructors.find(i => i.id.toString() === instructorId);
            if (instructor) {
                setRecipient(instructor.name);
                setRate(instructor.hourly_rate?.toString() || '');
                fetchHours(instructor.id, date);
            }
        }
    }, [instructorId]);

    useEffect(() => {
        if (instructorId !== 'manual') {
            fetchHours(parseInt(instructorId), date);
        }
    }, [date]);

    const fetchHours = async (id: number, dateStr: string) => {
        if (!dateStr || isNaN(id)) return;
        const yearMonth = dateStr.substring(0, 7);
        const result = await window.api.schedules.instructorSalary(id, yearMonth);
        if (result.success && result.data && typeof result.data.totalHours === 'number') {
            setHours(result.data.totalHours.toFixed(1));
            const r = parseFloat(rate) || 0;
            if (r > 0) {
                setGross(Math.round(r * result.data.totalHours).toString());
            }
        }
    };

    const calcGross = (r: string, h: string) => {
        const rateVal = parseFloat(r);
        const hoursVal = parseFloat(h);
        if (!isNaN(rateVal) && !isNaN(hoursVal)) {
            setGross(Math.round(rateVal * hoursVal).toString());
        }
    };

    const calcHours = (g: string, r: string) => {
        const grossVal = parseFloat(g);
        const rateVal = parseFloat(r);
        if (!isNaN(grossVal) && !isNaN(rateVal) && rateVal > 0) {
            setHours((Math.round((grossVal / rateVal) * 10) / 10).toString());
        }
    };

    const preview = calculateWithholding(parseFloat(gross) || 0, withholdingType);

    const handleSave = async () => {
        const grossVal = parseFloat(gross);
        if (!recipient.trim() || !grossVal || !date) {
            toast.error('수령인, 지급일, 금액을 입력하세요.');
            return;
        }

        const api = window.api;
        const result = await api.accounting.createPayroll({
            instructor_id: instructorId === 'manual' ? null : parseInt(instructorId),
            recipient_name: recipient,
            year_month: date.slice(0, 7),
            payment_date: date,
            gross_amount: grossVal,
            withholding_type: withholdingType,
            hours_worked: parseFloat(hours) || null,
            hourly_rate: parseFloat(rate) || null,
            payment_method: method,
            notes: notes || null,
        });

        if (result.success) {
            toast.success('급여가 지급되었습니다.');
            onSuccess();
            onOpenChange(false);
            setInstructorId('manual');
            setRecipient('');
            setGross('');
        } else {
            console.error(result.error);
            toast.error('급여 지급에 실패했습니다.');
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle>급여 지급</DialogTitle>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="space-y-2">
                        <Label>강사 선택</Label>
                        <Select value={instructorId} onValueChange={setInstructorId}>
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="강사 선택" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="manual">직접 입력</SelectItem>
                                {instructors.map(i => (
                                    <SelectItem key={i.id} value={i.id.toString()}>
                                        {i.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="recipient">수령인</Label>
                        <Input
                            id="recipient"
                            type="text"
                            value={recipient}
                            onChange={e => setRecipient(e.target.value)}
                            disabled={instructorId !== 'manual'}
                            placeholder="직접 입력 시 이름"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="hours">근무 시간</Label>
                            <Input
                                id="hours"
                                type="number"
                                value={hours}
                                onChange={e => {
                                    setHours(e.target.value);
                                    calcGross(rate, e.target.value);
                                }}
                                step="0.5" min="0" placeholder="예: 12"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="rate">시급(원)</Label>
                            <Input
                                id="rate"
                                type="number"
                                value={rate}
                                onChange={e => {
                                    setRate(e.target.value);
                                    calcGross(e.target.value, hours);
                                }}
                                min="0" placeholder="시급 입력"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="gross">총 지급액 (원)</Label>
                        <Input
                            id="gross"
                            type="number"
                            value={gross}
                            onChange={e => {
                                setGross(e.target.value);
                                calcHours(e.target.value, rate);
                            }}
                            min="0" placeholder="예: 1000000"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>급여 유형</Label>
                        <div className="flex flex-col space-y-2 p-2 border rounded bg-white/50">
                            {[
                                { val: 'freelance_3.3', label: '일반 강사 (3.3% 세금 공제)' },
                                { val: 'other_8.8', label: '단기 특강 (8.8% 세금 공제)' },
                                { val: 'employee', label: '근로소득 (간이세액)' },
                                { val: 'none', label: '세금 없이 지급' }
                            ].map(opt => (
                                <label key={opt.val} className="radio-container">
                                    <input
                                        type="radio"
                                        name="payroll-type"
                                        value={opt.val}
                                        className="sr-only"
                                        checked={withholdingType === opt.val}
                                        onChange={() => setWithholdingType(opt.val as WithholdingType)}
                                    />
                                    <div className="outer-ring"><div className="inner-dot"></div></div>
                                    <span className="radio-label text-sm">{opt.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 p-3 bg-muted/50 rounded-lg text-sm text-center">
                        <div>
                            <span className="block text-muted-foreground text-xs">세금 공제</span>
                            <strong className="text-red-600">{formatCurrency(preview.totalTax)}</strong>
                        </div>
                        <div>
                            <span className="block text-muted-foreground text-xs">실수령액</span>
                            <strong className="text-blue-600">{formatCurrency(preview.netAmount)}</strong>
                        </div>
                        <div>
                            <span className="block text-muted-foreground text-xs">세율</span>
                            <span className="font-medium text-inc-900">{formatPercent(preview.taxRate)}</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="date">지급일</Label>
                            <Input
                                id="date"
                                type="date"
                                value={date}
                                onChange={e => setDate(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>지급 방법</Label>
                            <Select value={method} onValueChange={setMethod}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="지급 방법" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="bank_transfer">계좌이체</SelectItem>
                                    <SelectItem value="cash">현금</SelectItem>
                                    <SelectItem value="card">카드</SelectItem>
                                    <SelectItem value="other">기타</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="notes">메모</Label>
                        <Textarea
                            id="notes"
                            rows={2}
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="선택 사항"
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
                    <Button onClick={handleSave}>지급 완료</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
