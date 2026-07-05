import React, { useState } from 'react';
import { toast } from 'sonner';
import { useAccountingStore } from '../../stores/accountingStore';
import { emitDataChange } from '../../core/events';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { PasswordConfirmDialog } from '../security/PasswordConfirmDialog';

export function TaxReportExport() {
    const exportStart = useAccountingStore((state) => state.exportStart);
    const exportEnd = useAccountingStore((state) => state.exportEnd);
    const setExportRange = useAccountingStore((state) => state.setExportRange);

    const [options, setOptions] = useState({
        includeRevenue: true,
        includePayroll: true,
        includeExpenses: true,
        includeProfitLoss: true,
    });

    const [isExporting, setIsExporting] = useState(false);
    const [pendingExport, setPendingExport] = useState<'tax' | 'payroll' | null>(null);

    const handleDateChange = (field: 'start' | 'end', value: string) => {
        if (field === 'start') {
            setExportRange(value, exportEnd);
        } else {
            setExportRange(exportStart, value);
        }
    };

    const toggleOption = (key: keyof typeof options) => {
        setOptions(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handleExportTax = async () => {
        setIsExporting(true);
        try {
            const api = window.api;
            const exportOptions = {
                startDate: exportStart,
                endDate: exportEnd,
                ...options
            };

            const filePath = await api.accounting.exportTaxReport(exportOptions);
            toast.success('세무 자료가 저장되었습니다', {
                description: `저장 위치: ${filePath}`
            });
            emitDataChange('accounting');
        } catch (error) {
            console.error(error);
            toast.error('내보내기에 실패했습니다');
        } finally {
            setIsExporting(false);
        }
    };

    const handleExportPayroll = async () => {
        setIsExporting(true);
        try {
            const api = window.api;
            const filePath = await api.accounting.exportPayrollReport({
                startDate: exportStart,
                endDate: exportEnd
            });
            toast.success('급여 내역이 저장되었습니다', {
                description: `저장 위치: ${filePath}`
            });
        } catch (error) {
            console.error(error);
            toast.error('내보내기에 실패했습니다');
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="acc-content space-y-4" id="content-export">
            <div className="acc-toolbar">
                <h3 className="text-lg font-semibold text-[var(--ink)]">세무 자료 내보내기</h3>
            </div>

            <Card className="max-w-2xl mx-auto bg-white/50 backdrop-blur">
                <CardHeader>
                    <CardTitle className="text-base text-[var(--ink)]">내보내기 설정</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="start-date">기간 시작</Label>
                            <Input
                                id="start-date"
                                type="date"
                                value={exportStart}
                                onChange={(e) => handleDateChange('start', e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="end-date">기간 종료</Label>
                            <Input
                                id="end-date"
                                type="date"
                                value={exportEnd}
                                onChange={(e) => handleDateChange('end', e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="space-y-3">
                        <Label>포함할 데이터</Label>
                        <div className="grid grid-cols-2 gap-4">
                            {[
                                { key: 'includeRevenue', label: '월별 매출 내역' },
                                { key: 'includePayroll', label: '강사 급여 지급 내역' },
                                { key: 'includeExpenses', label: '지출 장부' },
                                { key: 'includeProfitLoss', label: '손익 요약' }
                            ].map(({ key, label }) => (
                                <div key={key} className="flex items-center space-x-2 p-2 rounded hover:bg-[var(--bg-deep)] transition-colors">
                                    <Checkbox
                                        id={key}
                                        checked={options[key as keyof typeof options]}
                                        onCheckedChange={() => toggleOption(key as keyof typeof options)}
                                    />
                                    <Label htmlFor={key} className="cursor-pointer text-sm font-normal text-[var(--ink)]">{label}</Label>
                                </div>
                            ))}
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="flex flex-col gap-3 border-t bg-muted/20 p-6">
                    <div className="flex gap-3 w-full justify-end">
                        <Button
                            variant="outline"
                            onClick={() => setPendingExport('payroll')}
                            disabled={isExporting}
                        >
                            급여 내역만 내보내기
                        </Button>
                        <Button
                            onClick={() => setPendingExport('tax')}
                            disabled={isExporting}
                        >
                            {isExporting ? '처리 중...' : '세무 자료 내보내기'}
                        </Button>
                    </div>
                    <p className="text-xs text-[var(--muted)] text-center w-full">
                        ※ CSV 파일로 저장되며, 엑셀에서 열 수 있습니다.
                    </p>
                </CardFooter>
            </Card>

            <PasswordConfirmDialog
                open={pendingExport !== null}
                onOpenChange={(open) => {
                    if (!open) setPendingExport(null);
                }}
                title="자료 내보내기"
                description="세무·급여 자료에는 개인정보와 금액 정보가 포함됩니다. 내보내려면 비밀번호를 다시 확인하세요."
                confirmLabel="내보내기"
                onConfirm={async () => {
                    if (pendingExport === 'tax') {
                        await handleExportTax();
                    } else if (pendingExport === 'payroll') {
                        await handleExportPayroll();
                    }
                    setPendingExport(null);
                }}
            />
        </div>
    );
}
