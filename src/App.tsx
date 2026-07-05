'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Sidebar } from './components/layout/Sidebar';
import { LoginPage } from './screens/LoginPage';
import { PinLockScreen } from './components/security/PinLockScreen';
import { NoAcademyScreen } from './components/security/NoAcademyScreen';
import { useIdleTimer } from './core/hooks/useIdleTimer';
import { pinApi } from './core/api/pin';
import { logger } from './core/logger';
import { getAcademyName } from './features/lms/service';
import './pointer-safety';

export type AppPage = 'home' | 'classrooms' | 'instructors' | 'students' | 'accounting' | 'settings';

const pageHref: Record<AppPage, string> = {
    home: '/',
    classrooms: '/classrooms',
    instructors: '/instructors',
    students: '/students',
    accounting: '/accounting',
    settings: '/settings',
};

function pageFromPath(pathname: string): AppPage {
    if (pathname.startsWith('/classrooms')) return 'classrooms';
    if (pathname.startsWith('/instructors')) return 'instructors';
    if (pathname.startsWith('/students')) return 'students';
    if (pathname.startsWith('/accounting')) return 'accounting';
    if (pathname.startsWith('/settings')) return 'settings';
    return 'home';
}

function LoadingScreen() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
            <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-white/70">초기화 중...</p>
            </div>
            <Toaster position="top-right" />
        </div>
    );
}

function AuthenticatedApp({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const [academyName, setAcademyName] = useState<string | null>(null);
    const { signOut, profile, user, isLocked, hasPin, idleTimeout, setLocked } = useAuth();
    const activePage = useMemo(() => pageFromPath(pathname), [pathname]);

    useEffect(() => {
        const fetchAcademyName = async () => {
            if (!profile?.current_academy_id) {
                setAcademyName(null);
                return;
            }
            try {
                setAcademyName(await getAcademyName(String(profile.current_academy_id)));
            } catch (err) {
                console.error('[App] Failed to fetch academy name:', err);
            }
        };
        fetchAcademyName();
    }, [profile?.current_academy_id]);

    const handleIdle = useCallback(() => {
        if (hasPin) {
            logger.debug('App', 'Idle timeout reached, locking screen');
            setLocked(true);
        }
    }, [hasPin, setLocked]);

    useIdleTimer(idleTimeout, handleIdle, hasPin);

    const handleUnlock = useCallback(() => {
        setLocked(false);
    }, [setLocked]);

    const handleVerifyPin = useCallback(async (pin: string): Promise<boolean> => {
        if (!user?.id) return false;
        try {
            return await pinApi.verifyPin(user.id, pin);
        } catch (err) {
            console.error('[App] PIN verification error:', err);
            return false;
        }
    }, [user?.id]);

    const handleNavigate = useCallback((page: AppPage | string) => {
        const href = pageHref[page as AppPage] ?? '/';
        router.push(href);
    }, [router]);

    if (isLocked && hasPin) {
        return (
            <>
                <PinLockScreen
                    onUnlock={handleUnlock}
                    onVerify={handleVerifyPin}
                    userEmail={profile?.email}
                />
                <Toaster position="top-right" />
            </>
        );
    }

    return (
        <div className="app-layout flex h-screen w-screen bg-background text-foreground overflow-hidden">
            <Sidebar
                activePage={activePage}
                onNavigate={handleNavigate}
                onSignOut={signOut}
                userProfile={profile}
                academyName={academyName}
            />
            <main className="flex-1 relative overflow-hidden flex flex-col">
                {children}
            </main>
            <Toaster position="top-right" />
        </div>
    );
}

function AppContent({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { user, profile, loading } = useAuth();

    useEffect(() => {
        if (loading) return;
        if (!user && pathname !== '/login') {
            router.replace('/login');
        }
        if (user && pathname === '/login') {
            router.replace('/');
        }
    }, [loading, pathname, router, user]);

    if (loading) {
        return <LoadingScreen />;
    }

    if (!user) {
        return (
            <>
                <LoginPage />
                <Toaster position="top-right" />
            </>
        );
    }

    if (!profile?.current_academy_id) {
        return (
            <>
                <NoAcademyScreen userEmail={profile?.email} />
                <Toaster position="top-right" />
            </>
        );
    }

    return <AuthenticatedApp>{children}</AuthenticatedApp>;
}

export function App({ children }: { children: React.ReactNode }) {
    return (
        <AuthProvider>
            <AppContent>{children}</AppContent>
        </AuthProvider>
    );
}
