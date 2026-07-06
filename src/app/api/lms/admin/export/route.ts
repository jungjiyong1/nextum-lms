import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertReauthCookie } from '@/lib/lms/reauth';
import { recordAdminAction } from '@/lib/lms/audit';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import {
    buildPayrollExport,
    buildTaxReportExport,
    type ExportDateRange,
    type TaxReportExportOptions,
} from '@/lib/lms/admin-operations';

function csvResponse(filename: string, csv: string) {
    return new Response(`\uFEFF${csv}`, {
        status: 200,
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store',
        },
    });
}

function exportAuditPayload(type: 'tax' | 'payroll', options: TaxReportExportOptions | ExportDateRange, filename: string) {
    const taxOptions = options as TaxReportExportOptions;
    return {
        type,
        filename,
        startDate: options.startDate,
        endDate: options.endDate,
        includedSections: type === 'tax'
            ? {
                revenue: taxOptions.includeRevenue === true,
                payroll: taxOptions.includePayroll === true,
                expenses: taxOptions.includeExpenses === true,
                profitLoss: taxOptions.includeProfitLoss === true,
            }
            : { payroll: true },
    };
}

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        const body = await request.json() as {
            academyId?: string;
            type?: 'tax' | 'payroll';
            options?: TaxReportExportOptions | ExportDateRange;
        };

        if (!body.academyId || !body.type || !body.options?.startDate || !body.options?.endDate) {
            return Response.json({ success: false, error: 'Invalid export request.' }, { status: 400 });
        }

        const admin = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin']);
        await assertReauthCookie({ userId: admin.userId, academyId: body.academyId });

        const output = body.type === 'tax'
            ? await buildTaxReportExport(body.options as TaxReportExportOptions, body.academyId)
            : await buildPayrollExport(body.options as ExportDateRange, body.academyId);
        await recordAdminAction({
            academyId: body.academyId,
            actorPersonId: admin.personId,
            action: 'lms.admin.export',
            target: body.type,
            payload: exportAuditPayload(body.type, body.options, output.filename),
        });

        return csvResponse(output.filename, output.csv);
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Admin Export] Failed:', error);
        return Response.json({ success: false, error: 'Export failed.' }, { status: 500 });
    }
}
