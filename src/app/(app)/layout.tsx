import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/layout/AppShell';
import { LmsAuthError } from '@/lib/lms/auth';
import { loadAppShellContext } from '@/lib/lms/shell-context';

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
    try {
        const context = await loadAppShellContext();
        return (
            <AppShell academyName={context.academyName} profile={context.profile}>
                {children}
            </AppShell>
        );
    } catch (error) {
        if (error instanceof LmsAuthError && error.status === 401) {
            redirect('/login');
        }
        throw error;
    }
}
