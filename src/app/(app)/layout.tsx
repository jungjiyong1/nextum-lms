import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/layout/AppShell';
import { LmsAuthError } from '@/lib/lms/auth';
import { isPdfAssignmentMatchEnabled } from '@/lib/lms/pdf-assignment-match-feature';
import { AcademySelectionRequiredError, loadAppShellContext } from '@/lib/lms/shell-context';

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
    try {
        const context = await loadAppShellContext();
        return (
            <AppShell
                academyName={context.academyName}
                academyCount={context.academyCount}
                profile={context.profile}
                pdfAssignmentMatchEnabled={isPdfAssignmentMatchEnabled()}
            >
                {children}
            </AppShell>
        );
    } catch (error) {
        if (error instanceof AcademySelectionRequiredError) {
            redirect('/select-academy');
        }
        if (error instanceof LmsAuthError && error.status === 401) {
            redirect('/login');
        }
        throw error;
    }
}
