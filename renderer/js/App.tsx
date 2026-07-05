import React, { useState, useEffect, useCallback } from 'react';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Sidebar } from './components/layout/Sidebar';
import { ClassroomsPage } from './pages/ClassroomsPage';
import { AccountingMain } from './components/accounting/AccountingMain';
import { HomeDashboard } from './components/home/HomeDashboard';
import { StudentList } from './components/people/StudentList';
import { InstructorList } from './components/people/InstructorList';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { LoginPage } from './pages/LoginPage';
import { PinLockScreen } from './components/security/PinLockScreen';
import { NoAcademyScreen } from './components/security/NoAcademyScreen';
import { useIdleTimer } from './core/hooks/useIdleTimer';
import { pinApi } from './core/api';
import { logger } from './core/logger';
import { useLessonStore } from './stores/lessonStore';
import { useClassroomStore } from './stores/classroomStore';
import * as api from './core/api';

// 인증된 앱 콘텐츠
function AuthenticatedApp() {
    const [activePage, setActivePage] = useState('home');
    const [academyName, setAcademyName] = useState<string | null>(null);
    const { signOut, profile, user, isLocked, hasPin, idleTimeout, setLocked } = useAuth();

    // Fetch academy name when profile changes
    useEffect(() => {
        const fetchAcademyName = async () => {
            if (!profile?.current_academy_id) {
                setAcademyName(null);
                return;
            }
            try {
                const result = await api.getAcademyName(profile.current_academy_id);
                if (result.success) {
                    setAcademyName(result.data);
                }
            } catch (err) {
                console.error('[App] Failed to fetch academy name:', err);
            }
        };
        fetchAcademyName();
    }, [profile?.current_academy_id]);

    // Idle timer - lock screen after timeout
    const handleIdle = useCallback(() => {
        if (hasPin) {
            logger.debug('App', 'Idle timeout reached, locking screen');
            setLocked(true);
        }
    }, [hasPin, setLocked]);

    // Enable idle timer only if PIN is set
    useIdleTimer(idleTimeout, handleIdle, hasPin);

    // Handle PIN unlock
    const handleUnlock = useCallback(() => {
        setLocked(false);
    }, [setLocked]);

    // Handle PIN verification
    const handleVerifyPin = useCallback(async (pin: string): Promise<boolean> => {
        if (!user?.id) return false;
        try {
            return await pinApi.verifyPin(user.id, pin);
        } catch (err) {
            console.error('[App] PIN verification error:', err);
            return false;
        }
    }, [user?.id]);

    // Global Initialization
    useEffect(() => {
        const init = async () => {
            // Load initial data if needed
        };
        init();
    }, []);

    const renderContent = () => {
        const ScrollWrapper = ({ children }: { children: React.ReactNode }) => (
            <div className="h-full w-full overflow-y-auto overflow-x-hidden p-0">
                {children}
            </div>
        );

        switch (activePage) {
            case 'home':
                return <ScrollWrapper><HomeDashboard onNavigate={setActivePage} /></ScrollWrapper>;
            case 'classrooms':
                return <ClassroomsPage />;
            case 'instructors':
                return <ScrollWrapper><InstructorList /></ScrollWrapper>;
            case 'students':
                return <ScrollWrapper><StudentList /></ScrollWrapper>;
            case 'accounting':
                return <ScrollWrapper><AccountingMain /></ScrollWrapper>;
            case 'settings':
                return <ScrollWrapper><SettingsPanel /></ScrollWrapper>;
            default:
                return <ScrollWrapper><HomeDashboard onNavigate={setActivePage} /></ScrollWrapper>;
        }
    };

    // Show lock screen if locked
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
            <Sidebar activePage={activePage} onNavigate={setActivePage} onSignOut={signOut} userProfile={profile} academyName={academyName} />
            <main className="flex-1 relative overflow-hidden flex flex-col">
                {renderContent()}
            </main>
            <Toaster position="top-right" />
        </div>
    );
}

// 앱 루트 컴포넌트 - 인증 상태에 따른 조건부 렌더링
function AppContent() {
    const { user, profile, loading } = useAuth();

    // 로딩 중
    if (loading) {
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

    // 미인증 - 로그인 페이지 표시
    if (!user) {
        return (
            <>
                <LoginPage />
                <Toaster position="top-right" />
            </>
        );
    }

    // 학원 미지정 - 차단 화면 표시
    if (!profile?.current_academy_id) {
        return (
            <>
                <NoAcademyScreen userEmail={profile?.email} />
                <Toaster position="top-right" />
            </>
        );
    }

    // 인증됨 + 학원 지정됨 - 메인 앱 표시
    return <AuthenticatedApp />;
}

// 최종 App 컴포넌트 - AuthProvider로 래핑
export function App() {
    return (
        <AuthProvider>
            <AppContent />
        </AuthProvider>
    );
}
