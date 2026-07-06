import { describe, expect, it } from 'vitest';
import { getPayrollGrossAmount, getPayrollNetAmount } from './payrollAmounts';

describe('getPayrollGrossAmount', () => {
  it('uses gross_amount when the row stores a gross payroll value', () => {
    expect(getPayrollGrossAmount({
      amount: 968000,
      gross_amount: 1000000,
      net_amount: 968000,
      withholding_tax: 30000,
      local_tax: 2000,
    })).toBe(1000000);
  });

  it('reconstructs gross payroll from net amount and taxes for older rows', () => {
    expect(getPayrollGrossAmount({
      amount: 968000,
      net_amount: 968000,
      withholding_tax: 30000,
      local_tax: 2000,
    })).toBe(1000000);
  });

  it('falls back to legacy amount plus taxes when net_amount is missing', () => {
    expect(getPayrollGrossAmount({
      amount: 968000,
      withholding_tax: 30000,
      local_tax: 2000,
    })).toBe(1000000);
  });

  it('ignores zero defaults in newly added gross/net columns when legacy amount exists', () => {
    const row = {
      amount: 968000,
      gross_amount: 0,
      net_amount: 0,
      withholding_tax: 30000,
      local_tax: 2000,
    };

    expect(getPayrollGrossAmount(row)).toBe(1000000);
    expect(getPayrollNetAmount(row)).toBe(968000);
  });
});
