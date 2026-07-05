export function formatCurrency(amount: number): string {
  return `₩${Math.round(amount).toLocaleString()}`;
}

export function formatMonthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  return `${year}년 ${parseInt(month, 10)}월`;
}

export function formatPercent(rate: number, digits: number = 1): string {
  return `${rate.toFixed(digits)}%`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString();
}
