import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const instructorPage = readFileSync(resolve(
    process.cwd(),
    'src/features/lms/instructors-operations-page.tsx',
), 'utf8');
const accountingPage = readFileSync(resolve(
    process.cwd(),
    'src/features/lms/pages.tsx',
), 'utf8');
const accountingQuery = readFileSync(resolve(
    process.cwd(),
    'src/lib/lms/accounting-queries.ts',
), 'utf8');
const accountingRoute = readFileSync(resolve(
    process.cwd(),
    'src/app-routes/AccountingRoute.tsx',
), 'utf8');

describe('instructor and accounting workflow boundary', () => {
    it('keeps payroll workflows out of the instructor screen', () => {
        expect(instructorPage).not.toContain('createInstructorPayment');
        expect(instructorPage).not.toContain('value="payroll"');
        expect(instructorPage).not.toMatch(/급여|시급|지급/);
    });

    it('keeps payroll processing in the accounting screen', () => {
        expect(accountingPage).toContain('createInstructorPayment');
        expect(accountingRoute).toContain('view="payments"');
        expect(accountingRoute).toContain('view="payroll"');
        expect(accountingRoute).toContain('view="expenses"');
        expect(accountingPage).not.toContain('TabsList');
        expect(accountingPage).toContain('월 급여 예상');
        expect(accountingPage).toContain('추가금');
        expect(accountingPage).toContain('차감·기지급');
        expect(accountingPage).toContain('시급');
        expect(accountingQuery).toContain('loadSchedule');
        expect(accountingQuery).toContain('buildInstructorPayrollEstimates');
    });

    it('opens the class schedule first without an overview tab', () => {
        expect(instructorPage).toContain("useState('classes')");
        expect(instructorPage).toContain('value="classes"');
        expect(instructorPage).not.toContain('value="overview"');
    });
});
