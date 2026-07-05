import { authErrorResponse, assertLmsAdmin } from '@/lib/lms/auth';
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
        },
    });
}

export async function POST(request: Request) {
    try {
        const body = await request.json() as {
            type?: 'tax' | 'payroll';
            options?: TaxReportExportOptions | ExportDateRange;
        };

        if (!body.type || !body.options?.startDate || !body.options?.endDate) {
            return Response.json({ success: false, error: 'Invalid export request.' }, { status: 400 });
        }

        const admin = await assertLmsAdmin();
        const output = body.type === 'tax'
            ? await buildTaxReportExport(body.options as TaxReportExportOptions, admin.academyId)
            : await buildPayrollExport(body.options as ExportDateRange, admin.academyId);

        return csvResponse(output.filename, output.csv);
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Admin Export] Failed:', error);
        return Response.json({ success: false, error: 'Export failed.' }, { status: 500 });
    }
}
