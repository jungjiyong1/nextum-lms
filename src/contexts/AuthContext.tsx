'use client';

import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import type { AppProfile } from '@/core/auth/profile';
import { csrfHeaders } from '@/lib/lms/csrf-client';
import { createClient } from '@/lib/supabase/client';

export type Profile = AppProfile;

interface AuthContextValue {
    profile: Profile | null;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({
    children,
    profile,
}: {
    children: ReactNode;
    profile: Profile;
}) {
    const router = useRouter();

    const signOut = useCallback(async () => {
        await fetch('/api/lms/academy-selection', {
            method: 'DELETE',
            headers: csrfHeaders(),
        }).catch(() => undefined);

        const supabase = createClient();
        await supabase.auth.signOut();
        router.replace('/login');
        router.refresh();
    }, [router]);

    return (
        <AuthContext.Provider value={{ profile, signOut }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
