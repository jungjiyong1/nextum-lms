'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { AccessibleAcademy } from '@/lib/lms/academy-selection';
import { csrfHeaders, jsonCsrfHeaders } from '@/lib/lms/csrf-client';
import { createClient } from '@/lib/supabase/client';
import { getRoleLabel } from '@/core/auth/roles';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function AcademySelector({
    academies,
    displayName,
    isSuperAdmin,
}: {
    academies: AccessibleAcademy[];
    displayName: string;
    isSuperAdmin: boolean;
}) {
    const router = useRouter();
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [submittingId, setSubmittingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const selectAcademy = async (academy: AccessibleAcademy) => {
        setSelectedId(academy.id);
        setSubmittingId(academy.id);
        setError(null);

        try {
            const response = await fetch('/api/lms/academy-selection', {
                method: 'POST',
                headers: jsonCsrfHeaders(),
                body: JSON.stringify({ academyId: academy.id }),
            });
            const result = await response.json().catch(() => null) as {
                error?: string | { message?: string };
            } | null;

            if (!response.ok) {
                const message = typeof result?.error === 'string'
                    ? result.error
                    : result?.error?.message;
                throw new Error(message || '학원을 선택하지 못했습니다.');
            }

            router.replace('/');
            router.refresh();
        } catch (selectionError) {
            setError(selectionError instanceof Error
                ? selectionError.message
                : '학원을 선택하지 못했습니다.');
            setSubmittingId(null);
        }
    };

    const signOut = async () => {
        await fetch('/api/lms/academy-selection', {
            method: 'DELETE',
            headers: csrfHeaders(),
        }).catch(() => undefined);
        await createClient().auth.signOut();
        router.replace('/login');
        router.refresh();
    };

    return (
        <main className="min-h-screen bg-muted/30 px-4 py-10 sm:px-6 sm:py-16">
            <div className="mx-auto w-full max-w-3xl">
                <header className="mb-8 flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary-soft">
                            <Image src="/icon.png" alt="NEXTUM LMS" width={44} height={44} className="h-11 w-11 rounded-2xl" />
                        </span>
                        <div className="min-w-0">
                            <p className="truncate text-sm text-muted-foreground">{displayName}</p>
                            <h1 className="text-2xl font-bold tracking-tight text-foreground">접속할 학원을 선택하세요</h1>
                        </div>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void signOut()} className="shrink-0">
                        로그아웃
                    </Button>
                </header>

                {isSuperAdmin && (
                    <div className="mb-5 flex items-center gap-2 rounded-xl border border-primary/20 bg-primary-soft/60 px-4 py-3 text-sm text-primary-strong">
                        <span className="flex h-6 shrink-0 items-center rounded-full bg-primary px-2 text-[10px] font-bold text-primary-foreground">
                            ADMIN
                        </span>
                        <span>통합 관리자 계정으로 모든 학원에 접근할 수 있습니다.</span>
                    </div>
                )}

                <section aria-label="학원 목록" className="grid gap-3 sm:grid-cols-2">
                    {academies.map((academy) => {
                        const selected = selectedId === academy.id;
                        const submitting = submittingId === academy.id;

                        return (
                            <button
                                key={academy.id}
                                type="button"
                                onClick={() => void selectAcademy(academy)}
                                disabled={submittingId !== null}
                                className={cn(
                                    'group flex min-h-32 w-full items-center gap-4 rounded-2xl border bg-card p-5 text-left shadow-sm transition-all',
                                    'hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                                    selected && 'border-primary bg-primary-soft/30',
                                    submittingId !== null && !submitting && 'opacity-60',
                                )}
                            >
                                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary-strong">
                                    {submitting
                                        ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary" aria-label="접속 중" />
                                        : selected
                                            ? <span className="text-xl font-bold" aria-hidden="true">✓</span>
                                            : <span className="text-lg font-bold" aria-hidden="true">학</span>}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-base font-semibold text-foreground">{academy.name}</span>
                                    <span className="mt-1 block text-sm text-muted-foreground">{getRoleLabel(academy.role)} 권한</span>
                                </span>
                                <span className="shrink-0 text-2xl leading-none text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true">›</span>
                            </button>
                        );
                    })}
                </section>

                {error && (
                    <p role="alert" className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
                        {error}
                    </p>
                )}

                <p className="mt-6 text-center text-xs text-muted-foreground">
                    선택한 학원의 학생, 수업, 과제 데이터만 표시됩니다.
                </p>
            </div>
        </main>
    );
}
