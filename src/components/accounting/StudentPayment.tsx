import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import { useAccountingStore } from '../../stores/accountingStore';
import { formatCurrency, formatMonthLabel } from '../../modules/accounting/utils/formatters';
import { emitDataChange, onDataChange } from '../../core/events';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { Skeleton } from '../ui/skeleton';

interface StudentStatus {
    student_id: number;
    student_name: string;
    monthly_tuition: number;
    payment_cycle_day: number;
    is_paid: boolean;
    paid_amount: number;
    payment_date: string | null;
}

interface StudentOption {
    id: number;
    name: string;
    monthly_tuition: number | null;
}

export function StudentPayment() {
    const yearMonth = useAccountingStore((state) => state.yearMonth);
    const [students, setStudents] = useState<StudentStatus[]>([]);
    const [loading, setLoading] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [selectedStudentForPay, setSelectedStudentForPay] = useState<StudentStatus | null>(null);
    const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
    const [studentToCancel, setStudentToCancel] = useState<StudentStatus | null>(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        // @ts-ignore
        const api = window.api;
        const result = await api.accounting.studentMonthlyStatus(yearMonth);
        if (result.success) {
            setStudents(result.data);
        } else {
            console.error('Failed to load student payments:', result.error);
            toast.error('학생 수납 현황을 불러오지 못했습니다.');
        }
        setLoading(false);
    }, [yearMonth]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        const unsubscribe = onDataChange(({ scope }) => {
            if (['accounting', 'students', 'general'].includes(scope)) {
                loadData();
            }
        });
        return unsubscribe;
    }, [loadData]);

    const handleOpenPayment = (student?: StudentStatus) => {
        setSelectedStudentForPay(student || null);
        setIsDialogOpen(true);
    };

    const handleCancelPayment = (student: StudentStatus) => {
        setStudentToCancel(student);
        setCancelConfirmOpen(true);
    };

    const confirmCancelPayment = async () => {
        if (!studentToCancel) return;

        // @ts-ignore
        const result = await window.api.accounting.cancelStudentPayment(studentToCancel.student_id, yearMonth);
        if (result.success) {
            toast.success('납부 취소되었습니다.');
            loadData();
            emitDataChange('accounting');
        } else {
            console.error(result.error);
            toast.error('취소 실패');
        }
        setStudentToCancel(null);
    };

    return (
        <div className="acc-content" id="content-students">
            <div className="acc-toolbar">
                <h3>{formatMonthLabel(yearMonth)} 학생 수납 현황</h3>
                <Button onClick={() => handleOpenPayment()}>+ 납부 기록</Button>
            </div>

            {loading ? (
                <div className="space-y-2">
                    {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
            ) : students.length === 0 ? (
                <p className="acc-empty">등록된 학생이 없습니다.</p>
            ) : (
                <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                    <table className="acc-table w-full">
                        <thead className="sticky top-0 z-10">
                            <tr className="bg-[#e7e5e4]">
                                <th className="bg-[#e7e5e4]">이름</th>
                                <th className="bg-[#e7e5e4]">월 수강료</th>
                                <th className="bg-[#e7e5e4]">결제일</th>
                                <th className="bg-[#e7e5e4]">상태</th>
                                <th className="bg-[#e7e5e4]">납부액</th>
                                <th className="bg-[#e7e5e4]"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {students.map((s) => (
                                <tr key={s.student_id} className="odd:bg-white even:bg-[#e7e5e4] hover:odd:bg-white hover:even:bg-[#e7e5e4]">
                                    <td className="p-2"><strong>{s.student_name}</strong></td>
                                    <td className="p-2">{s.monthly_tuition > 0 ? formatCurrency(s.monthly_tuition) : <span className="text-muted">미설정</span>}</td>
                                    <td className="p-2">{s.monthly_tuition > 0 ? `매월 ${s.payment_cycle_day}일` : '-'}</td>
                                    <td className="p-2">
                                        {s.monthly_tuition > 0 ? (
                                            !!s.is_paid ?
                                                <span className="text-green-600 font-bold">완납</span> :
                                                <span className="text-red-500 font-bold">미납</span>
                                        ) : '-'}
                                    </td>
                                    <td className="p-2">{!!s.is_paid ? formatCurrency(s.paid_amount) : '-'}</td>
                                    <td className="p-2">
                                        {!s.is_paid && s.monthly_tuition > 0 && (
                                            <Button size="sm" onClick={() => handleOpenPayment(s)}>납부</Button>
                                        )}
                                        {!!s.is_paid && (
                                            <Button variant="destructive" size="sm" onClick={() => handleCancelPayment(s)}>수납 취소</Button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <PaymentDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                targetStudent={selectedStudentForPay}
                onSuccess={() => {
                    loadData();
                    emitDataChange('accounting');
                }}
            />

            <ConfirmDialog
                open={cancelConfirmOpen}
                onOpenChange={setCancelConfirmOpen}
                title="수납 취소"
                description={`${studentToCancel?.student_name || ''} 학생의 ${formatMonthLabel(yearMonth)} 납부 기록을 취소하시겠습니까?`}
                confirmLabel="취소하기"
                cancelLabel="돌아가기"
                variant="destructive"
                onConfirm={confirmCancelPayment}
            />
        </div>
    );
}

function PaymentDialog({ open, onOpenChange, targetStudent, onSuccess }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    targetStudent: StudentStatus | null;
    onSuccess: () => void;
}) {
    const [allStudents, setAllStudents] = useState<StudentOption[]>([]);
    const [selectedId, setSelectedId] = useState<string>('');
    const [searchTerm, setSearchTerm] = useState('');
    const [amount, setAmount] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [method, setMethod] = useState('card');
    const [isSearching, setIsSearching] = useState(false);

    // Load student list for autocomplete
    useEffect(() => {
        if (open) {
            // @ts-ignore
            window.api.students.list().then((result: any) => {
                if (result.success) {
                    setAllStudents(result.data);
                }
            });
        }
    }, [open]);

    // Set initial state based on targetStudent
    useEffect(() => {
        if (open) {
            if (targetStudent) {
                setSelectedId(targetStudent.student_id.toString());
                setSearchTerm(targetStudent.student_name);
                setAmount(targetStudent.monthly_tuition.toString());
                setIsSearching(false);
            } else {
                setSelectedId('');
                setSearchTerm('');
                setAmount('');
                setIsSearching(false);
            }
        }
    }, [open, targetStudent]);

    const filteredStudents = allStudents.filter(s =>
        (s.name || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleSelectStudent = (s: StudentOption) => {
        setSelectedId(s.id.toString());
        setSearchTerm(s.name || '');
        setAmount(s.monthly_tuition ? s.monthly_tuition.toString() : '');
        setIsSearching(false);
    };

    const handleSave = async () => {
        if (!selectedId || !amount) {
            toast.error('학생과 금액을 입력하세요.');
            return;
        }

        // @ts-ignore
        const result = await window.api.accounting.studentPayment({
            student_id: parseInt(selectedId),
            amount: parseFloat(amount),
            payment_method: method,
            payment_date: date
        });
        if (result.success) {
            toast.success('납부 처리가 완료되었습니다.');
            onSuccess();
            onOpenChange(false);
        } else {
            console.error(result.error);
            toast.error('납부 처리에 실패했습니다.');
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle>납부 기록</DialogTitle>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="space-y-2 relative">
                        <Label htmlFor="student-search">학생</Label>
                        {targetStudent ? (
                            <Input
                                id="student-search"
                                type="text"
                                value={searchTerm}
                                disabled
                            />
                        ) : (
                            <div className="relative">
                                <Input
                                    id="student-search"
                                    type="text"
                                    value={searchTerm}
                                    onChange={e => {
                                        setSearchTerm(e.target.value);
                                        setIsSearching(true);
                                        if (e.target.value === '') setSelectedId('');
                                    }}
                                    onFocus={() => setIsSearching(true)}
                                    placeholder="학생 이름 검색..."
                                />
                                {isSearching && searchTerm && (
                                    <ul className="absolute z-50 w-full mt-1 max-h-40 overflow-y-auto bg-[var(--panel)] border border-[var(--border)] rounded shadow-lg">
                                        {filteredStudents.length > 0 ? (
                                            filteredStudents.map(s => (
                                                <li
                                                    key={s.id}
                                                    onClick={() => handleSelectStudent(s)}
                                                    className="p-2 hover:bg-[var(--accent-soft)] cursor-pointer text-sm"
                                                >
                                                    {s.name}
                                                </li>
                                            ))
                                        ) : (
                                            <li className="p-2 text-muted-foreground text-sm">검색 결과 없음</li>
                                        )}
                                    </ul>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="amount">금액 (원)</Label>
                        <Input
                            id="amount"
                            type="number"
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="payment-date">결제일</Label>
                        <Input
                            id="payment-date"
                            type="date"
                            value={date}
                            onChange={e => setDate(e.target.value)}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="payment-method">결제수단</Label>
                        <Select value={method} onValueChange={setMethod}>
                            <SelectTrigger id="payment-method" className="w-full">
                                <SelectValue placeholder="결제수단 선택" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="card">카드</SelectItem>
                                <SelectItem value="cash">현금</SelectItem>
                                <SelectItem value="bank_transfer">계좌이체</SelectItem>
                                <SelectItem value="zeropay">제로페이</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
                    <Button onClick={handleSave}>저장</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
