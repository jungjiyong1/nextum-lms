'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import type { AppProfile } from '@/core/auth/profile';
import { AssignmentCreatePage, AssignmentsStatusPage } from '@/features/lms/assignments-operations-page';
import type { AssignmentManagementData } from '@/features/lms/types';
import {
    appPageFromPath,
    appPageHref,
    canAccessAppPath,
    canAccessAppPage,
    firstAccessibleAppPage,
    getRoleLabel,
} from '@/core/auth/roles';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import {
    addLmsInvalidationListener,
    loadAssignmentManagementData,
    primeAssignmentManagementData,
    subscribeLmsInvalidations,
} from '@/features/lms/service';

import { AccessDeniedScreen } from '../security/AccessDeniedScreen';
import { Sidebar } from './Sidebar';

function AssignmentManagementDataSeed({
    academyId,
    children,
    data,
}: {
    academyId: string;
    children: ReactNode;
    data: AssignmentManagementData;
}) {
    useState(() => {
        primeAssignmentManagementData(academyId, data);
        return true;
    });
    return children;
}

function AppShellContent({
    academyCount,
    academyName,
    children,
    pdfAssignmentMatchEnabled,
}: {
    academyCount: number;
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
        const academyId = profile?.current_academy_id;
        if (!academyId) return undefined;
        return addLmsInvalidationListener((payload) => {
            if (payload.academyId && payload.academyId !== academyId) return;
            const domain = payload.domain || 'lms';
            if (!['assignments', 'students', 'classes', 'learning', 'lms', 'admin'].includes(domain)) return;
            void loadAssignmentManagementData(academyId, { force: true }).catch(() => undefined);
        });
    }, [profile?.current_academy_id]);

    useEffect(() => {
        if (canAccessCurrentPage || !fallbackPage || fallbackPage === activePage) return;
        router.replace(appPageHref[fallbackPage]);
    }, [activePage, canAccessCurrentPage, fallbackPage, router]);

    const handleSignOut = useCallback(() => {
        void signOut();
    }, [signOut]);

    const routeContent = pathname === '/assignments'
        ? <AssignmentsStatusPage />
        : pathname === '/assignments/new'
            ? <AssignmentCreatePage />
            : children;
    const mainContent = canAccessCurrentPath
        ? routeContent
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
                canSwitchAcademy={academyCount > 1}
                pdfAssignmentMatchEnabled={pdfAssignmentMatchEnabled}
            />
            <main className="relative flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
                {mainContent}
            </main>
        </div>
    );
}

export function AppShell({
    academyId,
    academyCount,
    academyName,
    children,
    initialAssignmentManagementData,
    profile,
    pdfAssignmentMatchEnabled,
}: {
    academyId: string;
    academyCount: number;
    academyName: string;
    children: ReactNode;
    initialAssignmentManagementData: AssignmentManagementData;
    profile: AppProfile;
    pdfAssignmentMatchEnabled: boolean;
}) {
    return (
        <AuthProvider profile={profile}>
            <AssignmentManagementDataSeed
                key={academyId}
                academyId={academyId}
                data={initialAssignmentManagementData}
            >
                <AppShellContent
                    academyCount={academyCount}
                    academyName={academyName}
                    pdfAssignmentMatchEnabled={pdfAssignmentMatchEnabled}
                >
                    {children}
                </AppShellContent>
            </AssignmentManagementDataSeed>
        </AuthProvider>
    );
}
