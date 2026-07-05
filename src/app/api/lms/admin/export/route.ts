import { assertRecentAuth, assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
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

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as {
            academyId?: string;
            type?: 'tax' | 'payroll';
            options?: TaxReportExportOptions | ExportDateRange;
        };

        if (!body.academyId || !body.type || !body.options?.startDate || !body.options?.endDate) {
            return Response.json({ success: false, error: 'Invalid export request.' }, { status: 400 });
        }

        const admin = await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin']);
        assertRecentAuth(admin);

        const output = body.type === 'tax'
            ? await buildTaxReportExport(body.options as TaxReportExportOptions, body.academyId)
            : await buildPayrollExport(body.options as ExportDateRange, body.academyId);

        return csvResponse(output.filename, output.csv);
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Admin Export] Failed:', error);
        return Response.json({ success: false, error: 'Export failed.' }, { status: 500 });
    }
}
