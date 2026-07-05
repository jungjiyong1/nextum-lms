import React, { useState, useEffect, useCallback } from 'react';
import { useAccountingStore } from '../../stores/accountingStore';
import { emitDataChange, onDataChange } from '../../core/events';
import { formatCurrency, formatMonthLabel, formatPercent } from '../../modules/accounting/utils/formatters';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Button } from '../ui/button';
import { PasswordConfirmDialog } from '../security/PasswordConfirmDialog';

interface IncomeTaxResult {
    grossIncome: number;
    deductibleExpenses: number;
    taxableIncome: number;
    calculatedTax: number;
    localTax: number;
    totalTax: number;
    withholdingPaid: number;
    additionalTax: number;
    refundAmount: number;
    effectiveRate: number;
}

interface WithholdingSummary {
    byMonth: Array<{ month: string; incomeTax: number; localTax: number; total: number }>;
    total: number;
}

interface VatSummary {
    taxType: string;
    vatRate: number;
    totalRevenue: number;
    taxableRevenue: number;
    exemptRevenue: number;
    estimatedVat: number;
}

interface IncomeStatement {
    tuitionIncome: number;
    otherIncome: number;
    otherIncomeByCategory: Array<{ category: string; amount: number }>;
    totalIncome: number;
    instructorSalary: number;
    otherExpenses: number;
    expensesByCategory: Array<{ category: string; amount: number }>;
    totalExpenses: number;
    netIncome: number;
    taxDeductibleExpenses: number;
    withReceiptExpenses: number;
}

export function TaxCalculator() {
    const yearMonth = useAccountingStore((state) => state.yearMonth);
    const taxYear = useAccountingStore((state) => state.taxYear);
    const taxView = useAccountingStore((state) => state.taxView) || 'monthly';
    const setTaxView = useAccountingStore((state) => state.setTaxView);
    const setTaxYear = useAccountingStore((state) => state.setTaxYear);

    const [incomeTax, setIncomeTax] = useState<IncomeTaxResult | null>(null);
    const [withholdingSummary, setWithholdingSummary] = useState<WithholdingSummary | null>(null);
    const [vatSummary, setVatSummary] = useState<VatSummary | null>(null);
    const [incomeStatement, setIncomeStatement] = useState<IncomeStatement | null>(null);
    const [settings, setSettings] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);
    const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);

    const loadData = useCallback(async () => {
        setLoading(true);
        // @ts-ignore
        const api = window.api;

        // Date calculations for Monthly Income Statement
        const [ymYear, ymMonth] = yearMonth.split('-').map(Number);
        const lastDay = new Date(ymYear, ymMonth, 0).getDate();
        const startDate = `${yearMonth}-01`;
        const endDate = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;

        const [incomeTaxResult, withholdingResult, settingsResult, vatResult, incomeStmtResult] = await Promise.all([
            api.accounting.estimateIncomeTax(taxYear),
            api.accounting.getWithholdingSummary(taxYear),
            api.accounting.getTaxSettings(),
            api.accounting.getVatSummary(taxYear),
            api.accounting.incomeStatement(startDate, endDate),
        ]);

        if (incomeTaxResult.success) setIncomeTax(incomeTaxResult.data);
        if (withholdingResult.success) setWithholdingSummary(withholdingResult.data);
        if (settingsResult.success) setSettings(settingsResult.data || {});
        if (vatResult.success) setVatSummary(vatResult.data);
        if (incomeStmtResult.success) {
            // Ensure arrays exist
            const stmt = incomeStmtResult.data || {};
            setIncomeStatement({
                ...stmt,
                otherIncomeByCategory: stmt.otherIncomeByCategory || [],
                expensesByCategory: stmt.expensesByCategory || [],
            });
        }

        setLoading(false);
    }, [yearMonth, taxYear]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        const unsubscribe = onDataChange(({ scope }) => {
            if (['accounting', 'general'].includes(scope)) {
                loadData();
            }
        });
        return unsubscribe;
    }, [loadData]);

    const handleSaveSettings = async () => {
        // @ts-ignore
        const result = await window.api.accounting.updateTaxSettings(settings);
        if (result.success) {
            toast.success('설정이 저장되었습니다.');
            emitDataChange('accounting');
        } else {
            toast.error('설정 저장 실패');
        }
    };

    const getYearOptions = () => {
        const now = new Date().getFullYear();
        const years: string[] = [];
        for (let i = now - 2; i <= now + 1; i += 1) {
            years.push(String(i));
        }
        return years;
    };

    const CATEGORY_LABELS: Record<string, string> = {
        'labor': '인건비', 'rent': '임대료', 'utilities': '공과금',
        'supplies': '소모품', 'marketing': '광고홍보', 'tax': '세금',
        'insurance': '보험료', 'maintenance': '유지보수', 'other': '기타',
        'material_sales': '교재판매', 'facility_rental': '시설대여',
        'consulting': '컨설팅', 'subsidy': '지원금', 'interest': '이자수익'
    };

    return (
        <div className="acc-content space-y-4" id="content-tax">
            <Tabs
                value={taxView}
                className="w-full"
                onValueChange={(val) => setTaxView(val as 'monthly' | 'annual')}
                layoutId="tax-view-tabs"
            >
                <div className="flex justify-between items-center mb-4">
                    <TabsList className="grid w-[400px] grid-cols-2">
                        <TabsTrigger value="monthly">월별 손익계산서</TabsTrigger>
                        <TabsTrigger value="annual">연간 보고서</TabsTrigger>
                    </TabsList>

                    {taxView === 'annual' && (
                        <div className="flex items-center gap-2">
                            <Label>조회 연도</Label>
                            <Select value={taxYear} onValueChange={(val) => setTaxYear(val)}>
                                <SelectTrigger className="w-[120px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {getYearOptions().map(y => (
                                        <SelectItem key={y} value={y}>{y}년</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </div>

                <TabsContent value="monthly" className="space-y-4">
                    <h4 className="text-lg font-semibold text-center my-4">{formatMonthLabel(yearMonth)} 손익계산서</h4>

                    {!incomeStatement ? (
                        <p className="text-center text-muted-foreground py-8">데이터를 불러오는 중...</p>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Income/Expense Grid */}
                            <div className="space-y-6">
                                {/* Income Card */}
                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-base text-blue-600">【 수 입 】</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-2 text-sm">
                                            <div className="flex justify-between">
                                                <span>수강료 수입</span>
                                                <strong className="text-blue-600">{formatCurrency(incomeStatement.tuitionIncome)}</strong>
                                            </div>
                                            {incomeStatement.otherIncomeByCategory.map(c => (
                                                <div key={c.category} className="flex justify-between">
                                                    <span>기타 ({CATEGORY_LABELS[c.category] || c.category})</span>
                                                    <strong className="text-blue-600">{formatCurrency(c.amount)}</strong>
                                                </div>
                                            ))}
                                            <div className="border-t pt-2 mt-2 flex justify-between text-base">
                                                <span className="font-semibold">수입 합계</span>
                                                <strong className="text-blue-600">{formatCurrency(incomeStatement.totalIncome)}</strong>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* Expense Card */}
                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-base text-red-600">【 지 출 】</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-2 text-sm">
                                            <div className="flex justify-between">
                                                <span>강사 인건비</span>
                                                <strong className="text-red-600">{formatCurrency(incomeStatement.instructorSalary)}</strong>
                                            </div>
                                            {incomeStatement.expensesByCategory.map(c => (
                                                <div key={c.category} className="flex justify-between">
                                                    <span>{CATEGORY_LABELS[c.category] || c.category}</span>
                                                    <strong className="text-red-600">{formatCurrency(c.amount)}</strong>
                                                </div>
                                            ))}
                                            <div className="border-t pt-2 mt-2 flex justify-between text-base">
                                                <span className="font-semibold">지출 합계</span>
                                                <strong className="text-red-600">{formatCurrency(incomeStatement.totalExpenses)}</strong>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Net Income & Tax Info */}
                            <div className="space-y-6">
                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-base">【 손 익 】</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className={`flex justify-between items-center text-lg font-bold p-4 rounded-lg ${incomeStatement.netIncome >= 0 ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'}`}>
                                            <span>순이익 (수입 - 지출)</span>
                                            {formatCurrency(incomeStatement.netIncome)}
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-base">【 세무 참고 】</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-2 text-sm">
                                            <div className="flex justify-between">
                                                <span>비용처리 가능 지출</span>
                                                <strong>{formatCurrency(incomeStatement.taxDeductibleExpenses)}</strong>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>증빙서류 있는 지출</span>
                                                <strong>{formatCurrency(incomeStatement.withReceiptExpenses)}</strong>
                                            </div>
                                            <div className={`flex justify-between ${incomeStatement.otherExpenses - incomeStatement.withReceiptExpenses > 0 ? 'text-amber-600 font-medium' : ''}`}>
                                                <span>증빙 없는 지출</span>
                                                <strong>{formatCurrency(incomeStatement.otherExpenses - incomeStatement.withReceiptExpenses)}</strong>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="annual">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Tax Settings */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">학원 세금 설정</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>사업자 유형</Label>
                                    <Select
                                        value={settings.business_type}
                                        onValueChange={v => setSettings({ ...settings, business_type: v })}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="sole_proprietor">개인사업자</SelectItem>
                                            <SelectItem value="corporation">법인</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>과세 유형</Label>
                                    <Select
                                        value={settings.tax_type}
                                        onValueChange={v => setSettings({ ...settings, tax_type: v })}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="exempt">면세</SelectItem>
                                            <SelectItem value="taxable">과세</SelectItem>
                                            <SelectItem value="mixed">겸영</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>기본 원천징수</Label>
                                    <Select
                                        value={settings.default_withholding}
                                        onValueChange={v => setSettings({ ...settings, default_withholding: v })}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="freelance_3.3">일반 강사 (3.3%)</SelectItem>
                                            <SelectItem value="other_8.8">단기 특강 (8.8%)</SelectItem>
                                            <SelectItem value="employee">근로소득</SelectItem>
                                            <SelectItem value="none">원천징수 없음</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>부가세율(%)</Label>
                                    <Input
                                        type="number"
                                        value={settings.vat_rate || 10}
                                        onChange={e => setSettings({ ...settings, vat_rate: e.target.value })}
                                    />
                                </div>
                                <div className="pt-2">
                                    <Button className="w-full" onClick={() => setConfirmSaveOpen(true)}>설정 저장</Button>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Income Tax Estimate */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">종합소득세 예상</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {!incomeTax ? (
                                    <p className="text-muted-foreground">데이터 불러오는 중...</p>
                                ) : (
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between"><span>총 수입</span><strong>{formatCurrency(incomeTax.grossIncome)}</strong></div>
                                        <div className="flex justify-between"><span>필요경비</span><strong>{formatCurrency(incomeTax.deductibleExpenses)}</strong></div>
                                        <div className="flex justify-between border-t pt-2 mt-2 font-medium"><span>과세표준</span><strong>{formatCurrency(incomeTax.taxableIncome)}</strong></div>
                                        <div className="flex justify-between"><span>종합소득세</span><strong>{formatCurrency(incomeTax.calculatedTax)}</strong></div>
                                        <div className="flex justify-between"><span>지방소득세</span><strong>{formatCurrency(incomeTax.localTax)}</strong></div>
                                        <div className="flex justify-between font-bold text-lg text-primary"><span>총 세금</span><strong>{formatCurrency(incomeTax.totalTax)}</strong></div>
                                        <div className="flex justify-between text-muted-foreground"><span>기납부 원천세</span><strong>{formatCurrency(incomeTax.withholdingPaid)}</strong></div>
                                        <div className={`flex justify-between font-bold ${incomeTax.additionalTax > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                            <span>추가 납부 예상</span>
                                            <strong>{formatCurrency(incomeTax.additionalTax)}</strong>
                                        </div>
                                        <div className="flex justify-between text-xs text-muted-foreground mt-2">
                                            <span>실효 세율</span>
                                            <span>{formatPercent(incomeTax.effectiveRate)}</span>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* VAT Summary */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">부가가치세 요약</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {!vatSummary ? (
                                    <p className="text-muted-foreground">데이터 불러오는 중...</p>
                                ) : (
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between"><span>과세 유형</span><strong>{vatSummary.taxType}</strong></div>
                                        <div className="flex justify-between"><span>부가세율</span><strong>{vatSummary.vatRate}%</strong></div>
                                        <div className="flex justify-between"><span>과세 매출</span><strong>{formatCurrency(vatSummary.taxableRevenue)}</strong></div>
                                        <div className="flex justify-between"><span>면세 매출</span><strong>{formatCurrency(vatSummary.exemptRevenue)}</strong></div>
                                        <div className="flex justify-between font-bold border-t pt-2 mt-2"><span>예상 부가세</span><strong>{formatCurrency(vatSummary.estimatedVat)}</strong></div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Withholding Summary Table */}
                        <Card className="lg:col-span-1">
                            <CardHeader>
                                <CardTitle className="text-base">원천세 납부 요약</CardTitle>
                            </CardHeader>
                            <CardContent className="p-0">
                                {!withholdingSummary || withholdingSummary.byMonth.length === 0 ? (
                                    <p className="p-6 text-muted-foreground">원천세 납부 기록이 없습니다.</p>
                                ) : (
                                    <div className="max-h-[300px] overflow-y-auto">
                                        <table className="acc-table w-full text-sm">
                                            <thead>
                                                <tr>
                                                    <th className="p-2 text-left bg-muted/20">월</th>
                                                    <th className="p-2 text-right bg-muted/20">소득세</th>
                                                    <th className="p-2 text-right bg-muted/20">지방세</th>
                                                    <th className="p-2 text-right bg-muted/20">합계</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {withholdingSummary.byMonth.map((row, idx) => (
                                                    <tr key={idx} className="border-b">
                                                        <td className="p-2">{formatMonthLabel(row.month)}</td>
                                                        <td className="p-2 text-right">{formatCurrency(row.incomeTax)}</td>
                                                        <td className="p-2 text-right">{formatCurrency(row.localTax)}</td>
                                                        <td className="p-2 text-right font-medium">{formatCurrency(row.total)}</td>
                                                    </tr>
                                                ))}
                                                <tr className="bg-muted/10 font-bold">
                                                    <td className="p-2">합계</td>
                                                    <td colSpan={3} className="p-2 text-right">{formatCurrency(withholdingSummary.total)}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        <div className="lg:col-span-2 bg-amber-50 p-4 rounded-lg border border-amber-200 text-sm text-amber-900">
                            <strong className="block mb-2">⚠️ 이 프로그램의 세금 계산은 참고용입니다.</strong>
                            <p>정확한 금액은 세무사와 상담하세요. 특히 다음 사항은 전문가 상담이 필요합니다.</p>
                            <ul className="list-disc pl-5 mt-1 space-y-1 text-xs">
                                <li>연간 매출 4,800만원 이상</li>
                                <li>직원 고용 시 4대보험 처리</li>
                                <li>부가세 과세/면세 판단</li>
                                <li>종합소득세 절세 전략</li>
                            </ul>
                        </div>
                    </div>
                </TabsContent>
            </Tabs>

            <PasswordConfirmDialog
                open={confirmSaveOpen}
                onOpenChange={setConfirmSaveOpen}
                title="세금 설정 저장"
                description="세금 설정은 민감한 관리자 설정입니다. 저장하려면 비밀번호를 다시 확인하세요."
                confirmLabel="저장"
                onConfirm={handleSaveSettings}
            />
        </div>
    );
}
