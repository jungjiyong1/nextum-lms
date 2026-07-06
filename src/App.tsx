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
import { Skeleton, SkeletonPanel } from './components/ui/skeleton';
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
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <aside className="hidden w-[220px] shrink-0 border-r bg-white p-4 sm:flex sm:flex-col">
        <div className="mb-8 flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <Skeleton className="h-5 w-24" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 rounded-lg px-2 py-2">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
        <div className="mt-auto space-y-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col p-6">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-7 w-36" />
            <Skeleton className="h-4 w-56 max-w-full" />
          </div>
          <Skeleton className="h-10 w-28" />
        </div>
        <div className="grid gap-5 xl:grid-cols-[0.9fr_1.5fr]">
          <SkeletonPanel rows={5} />
          <SkeletonPanel rows={6} />
        </div>
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
