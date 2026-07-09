'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function ErrorPage({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[App Router] Unhandled route error', {
            message: error.message,
            digest: error.digest,
        });
    }, [error]);

    return (
        <main className="flex min-h-screen items-center justify-center bg-background p-6">
            <section className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
                <h1 className="text-xl font-semibold">화면을 불러오지 못했습니다</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    잠시 후 다시 시도해 주세요. 문제가 계속되면 요청 ID와 함께 관리자에게 알려 주세요.
                </p>
                {error.digest && (
                    <p className="mt-3 font-mono text-xs text-muted-foreground">요청 ID: {error.digest}</p>
                )}
                <Button className="mt-6" onClick={reset}>다시 시도</Button>
            </section>
        </main>
    );
}
