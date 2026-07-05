import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { supabase, User, Session } from '../core/supabaseClient';
import { pinApi } from '../core/api';
import { loadAuthProfile } from '../core/api/identity';
import type { AuthProfile } from '../core/api/identity';
import { logger } from '../core/logger';

// Profile 타입 정의
export type Profile = AuthProfile;

// AuthContext 타입 정의
interface AuthContextType {
    user: User | null;
    session: Session | null;
    profile: Profile | null;
    loading: boolean;
    signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
    signOut: () => Promise<void>;
    // PIN Lock related
    isLocked: boolean;
    hasPin: boolean;
    idleTimeout: number;
    setLocked: (locked: boolean) => void;
    refreshPinStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
    children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);
    const [initialized, setInitialized] = useState(false);

    // PIN Lock state
    const [isLocked, setIsLocked] = useState(false);
    const [hasPin, setHasPin] = useState(false);
    const [idleTimeout, setIdleTimeout] = useState(10); // Default 10 minutes

    // 프로필 로드
    const loadProfile = async (authUser: User): Promise<Profile | null> => {
        logger.debug('Auth', 'Loading profile for user:', authUser.id);
        try {
            const data = await loadAuthProfile(authUser);

            // Update PIN status from profile
            setHasPin(!!data?.pin_hash);
            setIdleTimeout(data?.idle_timeout ?? 10);

            if (!data) {
                console.warn('[Auth] No LMS/core profile found for user:', authUser.id);
                return null;
            }

            logger.debug('Auth', 'Profile loaded successfully:', data);

            return data;
        } catch (err) {
            console.error('[Auth] Profile loading exception:', err);
            return null;
        }
    };

    // Refresh PIN status
    const refreshPinStatus = useCallback(async () => {
        if (!user?.id) return;
        try {
            const hasPinSet = await pinApi.hasPin(user.id);
            const timeout = await pinApi.getIdleTimeout(user.id);
            setHasPin(hasPinSet);
            setIdleTimeout(timeout);
        } catch (err) {
            console.error('[Auth] Failed to refresh PIN status:', err);
        }
    }, [user?.id]);

    // Set locked state
    const setLocked = useCallback((locked: boolean) => {
        setIsLocked(locked);
    }, []);

    // 초기 세션 확인 및 리스너 설정
    useEffect(() => {
        let isMounted = true;

        const initSession = async () => {
            logger.debug('Auth', 'Starting session initialization...');
            try {
                const { data: { session: currentSession }, error } = await supabase.auth.getSession();

                if (error) {
                    console.error('[Auth] getSession error:', error.message);
                }

                logger.debug('Auth', 'Current session:', currentSession ? 'exists' : 'null');

                if (currentSession && isMounted) {
                    setSession(currentSession);
                    setUser(currentSession.user);
                    logger.debug('Auth', 'User set:', currentSession.user.email);

                    const userProfile = await loadProfile(currentSession.user);
                    if (isMounted) {
                        setProfile(userProfile);
                    }
                }
            } catch (error) {
                console.error('[Auth] Session initialization error:', error);
            } finally {
                if (isMounted) {
                    logger.debug('Auth', 'Initialization complete, setting loading to false');
                    setLoading(false);
                    setInitialized(true);
                }
            }
        };

        initSession();

        // 인증 상태 변경 리스너
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event: string, newSession: Session | null) => {
                logger.debug('Auth', 'Auth state changed:', event, newSession?.user?.email);

                if (!isMounted) return;

                setSession(newSession);
                setUser(newSession?.user ?? null);

                if (newSession?.user) {
                    setLoading(true);
                    loadProfile(newSession.user).then(userProfile => {
                        if (isMounted) {
                            setProfile(userProfile);
                        }
                    }).finally(() => {
                        if (isMounted) {
                            setLoading(false);
                        }
                    });
                } else {
                    setProfile(null);
                    setHasPin(false);
                    setIsLocked(false);
                    setLoading(false);
                }
            }
        );

        return () => {
            isMounted = false;
            subscription.unsubscribe();
        };
    }, []); // 빈 의존성 배열로 마운트 시 한 번만 실행

    // 로그인
    const signIn = async (email: string, password: string) => {
        try {
            const { error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });
            return { error };
        } catch (error) {
            return { error: error as Error };
        }
    };

    // 로그아웃
    const signOut = async () => {
        await supabase.auth.signOut();
        setUser(null);
        setSession(null);
        setProfile(null);
        setHasPin(false);
        setIsLocked(false);
    };

    const value: AuthContextType = {
        user,
        session,
        profile,
        loading,
        signIn,
        signOut,
        // PIN Lock
        isLocked,
        hasPin,
        idleTimeout,
        setLocked,
        refreshPinStatus,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Hook for using auth context
export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
