'use client';

import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import type { AppProfile } from '@/core/auth/profile';
import {
    appPageFromPath,
    appPageHref,
    canAccessAppPath,
    canAccessAppPage,
    firstAccessibleAppPage,
    getRoleLabel,
} from '@/core/auth/roles';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { subscribeLmsInvalidations } from '@/features/lms/service';

import { AccessDeniedScreen } from '../security/AccessDeniedScreen';
import { Sidebar } from './Sidebar';

function AppShellContent({
    academyName,
    children,
    pdfAssignmentMatchEnabled,
}: {
    academyName: string;
    children: ReactNode;
    pdfAssignmentMatchEnabled: boolean;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const { profile, signOut } = useAuth();
    const activePage = useMemo(() => appPageFromPath(pathname), [pathname]);
    const canAccessCurrentPage = useMemo(
        () => canAccessAppPage(profile?.role, activePage),
        [activePage, profile?.role],
    );
    const canAccessCurrentPath = useMemo(
        () => canAccessAppPath(profile?.role, pathname),
        [pathname, profile?.role],
    );
    const fallbackPage = useMemo(() => firstAccessibleAppPage(profile?.role), [profile?.role]);

    useEffect(() => {
        const academyId = profile?.current_academy_id;
        if (!academyId) return undefined;
        return subscribeLmsInvalidations(academyId);
    }, [profile?.current_academy_id]);

    useEffect(() => {
        if (canAccessCurrentPage || !fallbackPage || fallbackPage === activePage) return;
        router.replace(appPageHref[fallbackPage]);
    }, [activePage, canAccessCurrentPage, fallbackPage, router]);

    const handleSignOut = useCallback(() => {
        void signOut();
    }, [signOut]);

    const mainContent = canAccessCurrentPath
        ? children
        : (
            <AccessDeniedScreen
                roleLabel={profile?.role ? getRoleLabel(profile.role) : undefined}
                userEmail={profile?.email}
                onSignOut={handleSignOut}
            />
        );

    return (
        <div className="app-layout flex h-screen w-screen overflow-hidden bg-background text-foreground">
            <Sidebar
                activePage={activePage}
                onSignOut={handleSignOut}
                userProfile={profile}
                academyName={academyName}
                pdfAssignmentMatchEnabled={pdfAssignmentMatchEnabled}
            />
            <main className="relative flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
                {mainContent}
            </main>
        </div>
    );
}

export function AppShell({
    academyName,
    children,
    profile,
    pdfAssignmentMatchEnabled,
}: {
    academyName: string;
    children: ReactNode;
    profile: AppProfile;
    pdfAssignmentMatchEnabled: boolean;
}) {
    return (
        <AuthProvider profile={profile}>
            <AppShellContent
                academyName={academyName}
                pdfAssignmentMatchEnabled={pdfAssignmentMatchEnabled}
            >
                {children}
            </AppShellContent>
        </AuthProvider>
    );
}
