import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  assertRole,
  authErrorResponse,
  loadPayments,
  loadPayroll,
  loadExpenses,
  loadTaxSettings,
} = vi.hoisted(() => ({
  assertRole: vi.fn(),
  authErrorResponse: vi.fn<(error: unknown) => Response | null>(() => null),
  loadPayments: vi.fn(),
  loadPayroll: vi.fn(),
  loadExpenses: vi.fn(),
  loadTaxSettings: vi.fn(),
}));

vi.mock('@/lib/lms/auth', () => ({
  assertLmsRoleForAcademy: assertRole,
  assertSameOrigin: vi.fn(),
  authErrorResponse,
}));

vi.mock('@/lib/lms/accounting-queries', () => ({
  loadStudentPaymentOperationsOverview: loadPayments,
  loadInstructorPayrollOperationsOverview: loadPayroll,
  loadExpenseOperationsOverview: loadExpenses,
  loadAccountingTaxSettings: loadTaxSettings,
}));

vi.mock('@/lib/lms/mutations', () => ({
  recordPaymentForAcademy: vi.fn(),
  createInstructorPaymentForAcademy: vi.fn(),
  createExpenseForAcademy: vi.fn(),
}));

vi.mock('@/lib/lms/reauth', () => ({ assertReauthCookie: vi.fn() }));
vi.mock('@/lib/lms/audit', () => ({ recordAdminAction: vi.fn() }));
vi.mock('@/lib/lms/admin-operations', () => ({ updateTaxSettingsForAcademy: vi.fn() }));
vi.mock('@/lib/lms/csrf-server', () => ({ assertCsrfToken: vi.fn() }));

import { GET as getPayments } from './payments/route';
import { GET as getPayroll } from './payroll/route';
import { GET as getExpenses } from './expenses/route';
import { GET as getTaxSettings } from './admin/tax-settings/route';

const ACADEMY_ID = '00000000-0000-4000-8000-000000000001';
const actor = { academyId: ACADEMY_ID, userId: 'user-1', personId: 'person-1', role: 'staff' };

describe('accounting operation GET routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authErrorResponse.mockReturnValue(null);
    assertRole.mockResolvedValue(actor);
  });

  it.each([
    ['payments', getPayments, loadPayments, { billing: [], payments: [] }],
    ['payroll', getPayroll, loadPayroll, { payroll: [], payrollEstimates: [], staff: [] }],
    ['expenses', getExpenses, loadExpenses, { expenses: [] }],
  ] as const)('loads only the %s domain for the selected month', async (_name, handler, loader, data) => {
    loader.mockResolvedValue(data);

    const response = await handler(new Request(
      `http://localhost/api/lms/${_name}?academyId=${ACADEMY_ID}&serviceMonth=2026-07`,
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ success: true, data });
    expect(assertRole).toHaveBeenCalledWith(ACADEMY_ID, ['owner', 'admin', 'staff']);
    expect(loader).toHaveBeenCalledWith(actor, '2026-07');
    for (const candidate of [loadPayments, loadPayroll, loadExpenses]) {
      expect(candidate).toHaveBeenCalledTimes(candidate === loader ? 1 : 0);
    }
  });

  it.each([
    ['payments', getPayments],
    ['payroll', getPayroll],
    ['expenses', getExpenses],
  ] as const)('rejects an impossible month in the %s route before authorization', async (_name, handler) => {
    const response = await handler(new Request(
      `http://localhost/api/lms/${_name}?academyId=${ACADEMY_ID}&serviceMonth=2026-13`,
    ));

    expect(response.status).toBe(400);
    expect(assertRole).not.toHaveBeenCalled();
    expect(loadPayments).not.toHaveBeenCalled();
    expect(loadPayroll).not.toHaveBeenCalled();
    expect(loadExpenses).not.toHaveBeenCalled();
  });

  it('loads tax settings only through an owner or administrator role check', async () => {
    const data = { payrollIncomeTaxRate: 3, payrollLocalTaxRate: 0.3, salesVatRate: 0 };
    const adminActor = { ...actor, role: 'admin' };
    assertRole.mockResolvedValue(adminActor);
    loadTaxSettings.mockResolvedValue(data);

    const response = await getTaxSettings(new Request(
      `http://localhost/api/lms/admin/tax-settings?academyId=${ACADEMY_ID}`,
    ));

    expect(response.status).toBe(200);
    expect(assertRole).toHaveBeenCalledWith(ACADEMY_ID, ['owner', 'admin']);
    expect(loadTaxSettings).toHaveBeenCalledWith(adminActor);
    await expect(response.json()).resolves.toEqual({ success: true, data });
  });

  it('returns the authorization response for a staff tax-settings request', async () => {
    const denied = new Error('forbidden');
    assertRole.mockRejectedValue(denied);
    authErrorResponse.mockImplementation((error) => (
      error === denied ? Response.json({ success: false, error: 'Forbidden' }, { status: 403 }) : null
    ));

    const response = await getTaxSettings(new Request(
      `http://localhost/api/lms/admin/tax-settings?academyId=${ACADEMY_ID}`,
    ));

    expect(response.status).toBe(403);
    expect(loadTaxSettings).not.toHaveBeenCalled();
  });
});
