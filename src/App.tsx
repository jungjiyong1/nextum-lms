'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Sidebar } from './components/layout/Sidebar';
import { LoginPage } from './screens/LoginPage';
import { PinLockScreen } from './components/security/PinLockScreen';
import { NoAcademyScreen } from './components/security/NoAcademyScreen';
import { AccessDeniedScreen } from './components/security/AccessDeniedScreen';
import { useIdleTimer } from './core/hooks/useIdleTimer';
import { pinApi } from './core/api/pin';
import { logger } from './core/logger';
import {
  appPageFromPath,
  appPageHref,
  canAccessAppPage,
  firstAccessibleAppPage,
  getRoleLabel,
  type AppPage,
} from './core/auth/roles';
import { getAcademyName } from './features/lms/service';
import './pointer-safety';

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="flex flex-col items-center gap-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
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
  const activePage = useMemo(() => appPageFromPath(pathname), [pathname]);
  const canAccessCurrentPage = useMemo(
    () => canAccessAppPage(profile?.role, activePage),
    [activePage, profile?.role],
  );
  const fallbackPage = useMemo(() => firstAccessibleAppPage(profile?.role), [profile?.role]);

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
    void fetchAcademyName();
  }, [profile?.current_academy_id]);

  useEffect(() => {
    if (!profile?.role || canAccessCurrentPage || !fallbackPage || fallbackPage === activePage) return;
    router.replace(appPageHref[fallbackPage]);
  }, [activePage, canAccessCurrentPage, fallbackPage, profile?.role, router]);

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
    const href = appPageHref[page as AppPage] ?? '/';
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

  const mainContent = canAccessCurrentPage
    ? children
    : (
      <AccessDeniedScreen
        roleLabel={profile?.role ? getRoleLabel(profile.role) : undefined}
        userEmail={profile?.email}
        onSignOut={signOut}
      />
    );

  return (
    <div className="app-layout flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        activePage={activePage}
        onNavigate={handleNavigate}
        onSignOut={signOut}
        userProfile={profile}
        academyName={academyName}
      />
      <main className="relative flex flex-1 flex-col overflow-hidden">
        {mainContent}
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
