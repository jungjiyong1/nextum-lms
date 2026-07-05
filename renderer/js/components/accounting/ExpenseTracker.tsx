import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { Checkbox } from '../../components/ui/checkbox';
import type { Expense } from '../../core/types';
import { formatCurrency, formatMonthLabel } from '../../modules/accounting/utils/formatters';
import { cn } from '../../lib/utils';
import { Trash2, Plus } from 'lucide-react';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { toast } from 'sonner';

interface ExpenseTrackerProps {
    expenses: Expense[];
    yearMonth: string;
    onAddExpense: (expense: Omit<Expense, 'id'>) => Promise<void>;
    onDeleteExpense: (id: number) => Promise<void>;
}

const CATEGORY_LABELS: Record<string, string> = {
    'labor': '인건비', 'rent': '임대료', 'utilities': '공과금',
    'supplies': '소모품', 'marketing': '광고홍보', 'tax': '세금',
    'insurance': '보험료', 'maintenance': '유지보수', 'other': '기타',
    'material_sales': '교재판매', 'facility_rental': '시설대여',
    'consulting': '컨설팅', 'subsidy': '지원금', 'interest': '이자수익'
};

const METHOD_LABELS: Record<string, string> = {
    'cash': '현금', 'card': '카드', 'bank_transfer': '계좌이체',
    'check': '수표', 'zeropay': '제로페이', 'auto_transfer': '자동이체', 'other': '기타'
};

export function ExpenseTracker({ expenses, yearMonth, onAddExpense, onDeleteExpense }: ExpenseTrackerProps) {
    const [isDialogOpen, setIsDialogOpen] = React.useState(false);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
    const [pendingDeleteId, setPendingDeleteId] = React.useState<number | null>(null);

    // Stats
    const total = expenses.reduce((sum, e) => sum + e.amount, 0);
    const deductible = expenses.filter((e) => e.tax_deductible).reduce((sum, e) => sum + e.amount, 0);
    const withReceipt = expenses.filter((e) => e.has_receipt).reduce((sum, e) => sum + e.amount, 0);

    const byCategory = React.useMemo(() => {
        const acc = expenses.reduce((acc, e) => {
            acc[e.category] = (acc[e.category] || 0) + e.amount;
            return acc;
        }, {} as Record<string, number>);
        return Object.entries(acc).sort((a, b) => b[1] - a[1]);
    }, [expenses]);

    // Form State
    const [newExpense, setNewExpense] = React.useState<Partial<Expense>>({
        expense_date: new Date().toISOString().split('T')[0],
        category: 'labor',
        payment_method: 'card',
        tax_deductible: true,
        has_receipt: false,
        amount: 0,
        description: '',
        recipient: '',
        notes: '',
    });

    const handleSubmit = async () => {
        if (!newExpense.description || !newExpense.amount) {
            toast.error('내용과 금액을 입력하세요.');
            return;
        }

        try {
            await onAddExpense(newExpense as Omit<Expense, 'id'>);
            toast.success('지출이 추가되었습니다.');
            setIsDialogOpen(false);
            // Reset form
            setNewExpense({
                expense_date: new Date().toISOString().split('T')[0],
                category: 'labor',
                payment_method: 'card',
                tax_deductible: true,
                has_receipt: false,
                amount: 0,
                description: '',
                recipient: '',
                notes: '',
            });
        } catch (e) {
            toast.error('지출 추가 실패');
            console.error(e);
        }
    };

    const handleDelete = (id: number) => {
        setPendingDeleteId(id);
        setDeleteConfirmOpen(true);
    };

    const confirmDelete = async () => {
        if (!pendingDeleteId) return;
        try {
            await onDeleteExpense(pendingDeleteId);
            toast.success('삭제되었습니다.');
        } catch (e) {
            toast.error('삭제 실패');
        }
        setPendingDeleteId(null);
    };

    return (
        <div className="space-y-6 p-1">
            {/* Header Toolbar */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-[var(--ink)]">{formatMonthLabel(yearMonth)} 지출 장부</h3>
                <div className="flex items-center gap-4">
                    <span className="text-sm font-medium text-[var(--muted)]">
                        총 지출: <span className="text-[var(--ink)] font-bold">{formatCurrency(total)}</span>
                    </span>
                    <Button onClick={() => setIsDialogOpen(true)} className="h-9 flex items-center">
                        <Plus className="mr-2 h-4 w-4" /> 지출 추가
                    </Button>
                </div>
            </div>

            <p className="text-[13px] text-[var(--muted)] bg-[var(--bg-deep)] p-3 rounded-md mb-4">
                ※ 강사 등록 없이 급여 지급, 임대료, 공과금, 소모품 등 모든 지출을 기록하세요.
            </p>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 text-[var(--ink)]">
                <div className="bg-[var(--bg-deep)] rounded-lg p-4 flex justify-between items-center">
                    <span className="text-[var(--muted)] text-sm font-bold">총 지출</span>
                    <strong className="text-2xl font-bold">{formatCurrency(total)}</strong>
                </div>
                <div className="bg-[var(--bg-deep)] rounded-lg p-4 flex justify-between items-center">
                    <span className="text-[var(--muted)] text-sm font-bold">세금공제 가능</span>
                    <strong className="text-2xl font-bold text-[#2563eb]">{formatCurrency(deductible)}</strong>
                </div>
                <div className="bg-[var(--bg-deep)] rounded-lg p-4 flex justify-between items-center">
                    <span className="text-[var(--muted)] text-sm font-bold">증빙 있음</span>
                    <strong className="text-2xl font-bold text-[var(--accent)]">{formatCurrency(withReceipt)}</strong>
                </div>
            </div>

            {/* Category Summary */}
            <div className="mb-4 border border-dashed border-[var(--border)] rounded-lg p-3">
                <h4 className="text-sm font-semibold mb-2 text-[var(--ink)]">카테고리별 지출</h4>
                {byCategory.length === 0 ? (
                    <p className="text-sm text-[var(--muted)] text-center py-2">지출 내역이 없습니다.</p>
                ) : (
                    <div className="flex flex-wrap gap-x-8 gap-y-2">
                        {byCategory.map(([cat, amt]) => (
                            <div key={cat} className="flex justify-between items-center gap-4 min-w-[120px] text-[13px]">
                                <span className="text-[var(--muted)]">{CATEGORY_LABELS[cat] || cat}</span>
                                <span className="font-bold text-[var(--ink)]">{formatCurrency(amt)}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Expenses Table */}
            <div className="rounded-md border border-[var(--border)] bg-white shadow-sm overflow-hidden">
                <table className="acc-table">
                    <thead>
                        <tr>
                            <th>날짜</th>
                            <th>분류</th>
                            <th>내용</th>
                            <th className="text-right">금액</th>
                            <th>수취인</th>
                            <th>결제</th>
                            <th className="text-center">공제</th>
                            <th className="text-center">증빙</th>
                            <th className="text-right"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {expenses.length === 0 ? (
                            <tr>
                                <td colSpan={9} className="h-24 text-center text-[var(--muted)]">지출 내역이 없습니다.</td>
                            </tr>
                        ) : (
                            expenses.map((e) => (
                                <tr key={e.id} className="hover:bg-[var(--bg-deep)] transition-colors">
                                    <td>{e.expense_date}</td>
                                    <td>{CATEGORY_LABELS[e.category] || e.category}</td>
                                    <td>{e.description}</td>
                                    <td className="text-right font-bold text-[#dc2626]">{formatCurrency(e.amount)}</td>
                                    <td>{e.recipient || '-'}</td>
                                    <td>{METHOD_LABELS[e.payment_method || ''] || '-'}</td>
                                    <td className="text-center">{e.tax_deductible ? '✓' : '-'}</td>
                                    <td className="text-center">{e.has_receipt ? '✓' : '-'}</td>
                                    <td className="text-right">
                                        <Button variant="ghost" size="icon" onClick={() => handleDelete(e.id)} className="h-8 w-8 text-[var(--muted)] hover:text-[#dc2626] hover:bg-red-50">
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Add Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>지출 추가</DialogTitle>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="date">날짜</Label>
                                <Input
                                    id="date"
                                    type="date"
                                    value={newExpense.expense_date}
                                    onChange={e => setNewExpense({ ...newExpense, expense_date: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="amount">금액 (원)</Label>
                                <Input
                                    id="amount"
                                    type="number"
                                    value={newExpense.amount || ''}
                                    onChange={e => setNewExpense({ ...newExpense, amount: parseInt(e.target.value) || 0 })}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>분류</Label>
                            <Select
                                value={newExpense.category}
                                onValueChange={(val) => setNewExpense({ ...newExpense, category: val })}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="분류 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                                        <SelectItem key={key} value={key}>{label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="description">내용</Label>
                            <Input
                                id="description"
                                type="text"
                                value={newExpense.description}
                                placeholder="지출 내용"
                                onChange={e => setNewExpense({ ...newExpense, description: e.target.value })}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="recipient">수취인/업체명</Label>
                                <Input
                                    id="recipient"
                                    type="text"
                                    value={newExpense.recipient || ''}
                                    placeholder="(선택)"
                                    onChange={e => setNewExpense({ ...newExpense, recipient: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>결제수단</Label>
                                <Select
                                    value={newExpense.payment_method || ''}
                                    onValueChange={(val) => setNewExpense({ ...newExpense, payment_method: val })}
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="결제수단 선택" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(METHOD_LABELS).map(([key, label]) => (
                                            <SelectItem key={key} value={key}>{label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="flex gap-6">
                            <div className="flex items-center space-x-2">
                                <Checkbox
                                    id="tax_deductible"
                                    checked={newExpense.tax_deductible}
                                    onCheckedChange={(checked) => setNewExpense({ ...newExpense, tax_deductible: checked === true })}
                                />
                                <Label htmlFor="tax_deductible" className="cursor-pointer">세금공제 가능</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Checkbox
                                    id="has_receipt"
                                    checked={newExpense.has_receipt}
                                    onCheckedChange={(checked) => setNewExpense({ ...newExpense, has_receipt: checked === true })}
                                />
                                <Label htmlFor="has_receipt" className="cursor-pointer">증빙서류 있음</Label>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="notes">메모</Label>
                            <Textarea
                                id="notes"
                                rows={2}
                                value={newExpense.notes || ''}
                                onChange={e => setNewExpense({ ...newExpense, notes: e.target.value })}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>취소</Button>
                        <Button onClick={handleSubmit}>저장</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirm Dialog */}
            <ConfirmDialog
                open={deleteConfirmOpen}
                onOpenChange={setDeleteConfirmOpen}
                title="지출 삭제"
                description="이 지출 기록을 삭제하시겠습니까?"
                confirmLabel="삭제"
                variant="destructive"
                onConfirm={confirmDelete}
            />
        </div>
    );
}
