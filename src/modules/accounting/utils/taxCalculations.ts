export type WithholdingType = 'freelance_3.3' | 'other_8.8' | 'employee' | 'none';

export interface WithholdingResult {
  grossAmount: number;
  incomeTax: number;
  localTax: number;
  totalTax: number;
  netAmount: number;
  taxRate: number;
  description: string;
}

interface IncomeTaxBracket {
  limit: number;
  rate: number;
  deduction: number;
}

const TAX_BRACKETS: IncomeTaxBracket[] = [
  { limit: 14000000, rate: 0.06, deduction: 0 },
  { limit: 50000000, rate: 0.15, deduction: 1260000 },
  { limit: 88000000, rate: 0.24, deduction: 5760000 },
  { limit: 150000000, rate: 0.35, deduction: 15440000 },
  { limit: 300000000, rate: 0.38, deduction: 19940000 },
  { limit: 500000000, rate: 0.4, deduction: 25940000 },
  { limit: 1000000000, rate: 0.42, deduction: 35940000 },
  { limit: Infinity, rate: 0.45, deduction: 65940000 },
];

export function calculateWithholding(grossAmount: number, type: WithholdingType): WithholdingResult {
  let incomeTax = 0;
  let description = '';

  switch (type) {
    case 'freelance_3.3':
      incomeTax = Math.floor(grossAmount * 0.03);
      description = '일반 강사 (사업소득 3.3%)';
      break;
    case 'other_8.8':
      incomeTax = Math.floor(grossAmount * 0.08);
      description = '단기 특강 (기타소득 8.8%)';
      break;
    case 'employee':
      incomeTax = calculateSimplifiedEmployeeTax(grossAmount);
      description = '근로소득 (간이세액)';
      break;
    case 'none':
    default:
      description = '원천징수 없음';
      break;
  }

  const localTax = Math.floor(incomeTax * 0.1);
  const totalTax = incomeTax + localTax;
  const netAmount = Math.max(0, grossAmount - totalTax);
  const taxRate = grossAmount > 0 ? (totalTax / grossAmount) * 100 : 0;

  return {
    grossAmount,
    incomeTax,
    localTax,
    totalTax,
    netAmount,
    taxRate,
    description,
  };
}

export interface IncomeTaxResult {
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

export function calculateIncomeTax(
  grossIncome: number,
  deductibleExpenses: number,
  withholdingPaid: number = 0
): IncomeTaxResult {
  const taxableIncome = Math.max(0, grossIncome - deductibleExpenses);
  let calculatedTax = 0;

  for (const bracket of TAX_BRACKETS) {
    if (taxableIncome <= bracket.limit) {
      calculatedTax = Math.floor(taxableIncome * bracket.rate - bracket.deduction);
      break;
    }
  }
  calculatedTax = Math.max(0, calculatedTax);

  const localTax = Math.floor(calculatedTax * 0.1);
  const totalTax = calculatedTax + localTax;
  const difference = totalTax - withholdingPaid;

  return {
    grossIncome,
    deductibleExpenses,
    taxableIncome,
    calculatedTax,
    localTax,
    totalTax,
    withholdingPaid,
    additionalTax: difference > 0 ? difference : 0,
    refundAmount: difference < 0 ? Math.abs(difference) : 0,
    effectiveRate: grossIncome > 0 ? (totalTax / grossIncome) * 100 : 0,
  };
}

function calculateSimplifiedEmployeeTax(monthly: number): number {
  if (monthly <= 1500000) return 0;
  if (monthly <= 3000000) return Math.floor((monthly - 1500000) * 0.06);
  return Math.floor(90000 + (monthly - 3000000) * 0.15);
}
