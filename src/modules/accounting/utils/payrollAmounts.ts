export interface PayrollAmountFields {
  amount?: number | null;
  gross_amount?: number | null;
  net_amount?: number | null;
  withholding_tax?: number | null;
  local_tax?: number | null;
}

function toCurrencyNumber(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function hasPositiveFallbackAmount(row: PayrollAmountFields): boolean {
  return toCurrencyNumber(row.net_amount) > 0
    || toCurrencyNumber(row.amount) > 0
    || toCurrencyNumber(row.withholding_tax) > 0
    || toCurrencyNumber(row.local_tax) > 0;
}

export function getPayrollGrossAmount(row: PayrollAmountFields): number {
  const grossAmount = toCurrencyNumber(row.gross_amount);
  if (row.gross_amount !== null && row.gross_amount !== undefined && (grossAmount > 0 || !hasPositiveFallbackAmount(row))) {
    return grossAmount;
  }
  const netAmount = toCurrencyNumber(row.net_amount) > 0
    ? toCurrencyNumber(row.net_amount)
    : toCurrencyNumber(row.amount);
  return netAmount + toCurrencyNumber(row.withholding_tax) + toCurrencyNumber(row.local_tax);
}

export function getPayrollNetAmount(row: PayrollAmountFields): number {
  const netAmount = toCurrencyNumber(row.net_amount);
  const legacyAmount = toCurrencyNumber(row.amount);
  if (row.net_amount !== null && row.net_amount !== undefined && (netAmount > 0 || legacyAmount === 0)) {
    return netAmount;
  }
  if (row.amount !== null && row.amount !== undefined && legacyAmount > 0) {
    return legacyAmount;
  }
  return Math.max(0, getPayrollGrossAmount(row) - toCurrencyNumber(row.withholding_tax) - toCurrencyNumber(row.local_tax));
}
