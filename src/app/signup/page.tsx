'use client';

import Link from 'next/link';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { jsonCsrfHeaders } from '@/lib/lms/csrf-client';

interface SignupResponse {
    email?: string;
    error?: { code?: string; message?: string };
}

function errorMessage(response: SignupResponse | null): string {
    switch (response?.error?.code) {
        case 'INVALID_INVITE_CODE': return '가입 코드가 올바르지 않습니다.';
        case 'INVITE_ALREADY_USED': return '이미 사용된 가입 코드입니다.';
        case 'INVITE_EXPIRED': return '만료된 가입 코드입니다. 학원 관리자에게 재발급을 요청하세요.';
        case 'LOGIN_ID_TAKEN': return '이미 사용 중인 아이디입니다.';
        case 'ACCOUNT_ALREADY_EXISTS': return '이미 로그인 계정이 연결된 사용자입니다.';
        default: return response?.error?.message || '회원가입에 실패했습니다.';
    }
}

export default function SignupPage() {
    const router = useRouter();
    const [inviteCode, setInviteCode] = useState('');
    const [loginId, setLoginId] = useState('');
    const [password, setPassword] = useState('');
    const [passwordConfirm, setPasswordConfirm] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const loginIdValid = useMemo(() => /^[a-z0-9._-]{3,64}$/.test(loginId.trim()), [loginId]);
    const passwordValid = password.length >= 8 && password === passwordConfirm;
    const canSubmit = Boolean(inviteCode.trim() && loginIdValid && passwordValid && !submitting);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        setError('');

        try {
            const response = await fetch('/api/signup/claim', {
                method: 'POST',
                headers: jsonCsrfHeaders(),
                body: JSON.stringify({
                    inviteCode: inviteCode.trim(),
                    loginId: loginId.trim(),
                    password,
                }),
            });
            const body = await response.json().catch(() => null) as SignupResponse | null;
            if (!response.ok || !body?.email) throw new Error(errorMessage(body));

            const { createClient } = await import('@/lib/supabase/client');
            const { error: signInError } = await createClient().auth.signInWithPassword({
                email: body.email,
                password,
            });
            if (signInError) throw signInError;

            await fetch('/api/lms/academy-selection', {
                method: 'DELETE',
                headers: jsonCsrfHeaders(),
            }).catch(() => undefined);
            router.replace('/');
            router.refresh();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : '회원가입에 실패했습니다.');
            setSubmitting(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
            <Card className="w-full max-w-md">
                <CardContent className="p-8">
                    <Link href="/login" className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                        로그인으로 돌아가기
                    </Link>

                    <div className="mb-8 mt-6 text-center">
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                            <BookOpen className="h-7 w-7" aria-hidden="true" />
                        </div>
                        <h1 className="mb-2 text-xl font-semibold text-foreground">강사·직원 회원가입</h1>
                        <p className="text-sm text-muted-foreground">학원에서 받은 일회용 코드로 계정을 만드세요.</p>
                    </div>

                    <form onSubmit={submit} className="space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="invite-code" className="pl-1 text-xs font-medium">가입 코드</Label>
                            <Input
                                id="invite-code"
                                value={inviteCode}
                                onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                                autoCapitalize="characters"
                                autoComplete="one-time-code"
                                autoCorrect="off"
                                placeholder="학원에서 받은 코드"
                                disabled={submitting}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="signup-login-id" className="pl-1 text-xs font-medium">아이디</Label>
                            <Input
                                id="signup-login-id"
                                value={loginId}
                                onChange={(event) => setLoginId(event.target.value.toLowerCase())}
                                autoCapitalize="none"
                                autoComplete="username"
                                autoCorrect="off"
                                placeholder="영문 소문자 또는 숫자 3자 이상"
                                disabled={submitting}
                            />
                            {loginId.trim() && !loginIdValid && (
                                <p className="px-1 text-xs text-danger">영문 소문자, 숫자, 점, 밑줄, 하이픈만 사용할 수 있습니다.</p>
                            )}
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="signup-password" className="pl-1 text-xs font-medium">비밀번호</Label>
                            <Input
                                id="signup-password"
                                type="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                autoComplete="new-password"
                                placeholder="8자 이상"
                                disabled={submitting}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="signup-password-confirm" className="pl-1 text-xs font-medium">비밀번호 확인</Label>
                            <Input
                                id="signup-password-confirm"
                                type="password"
                                value={passwordConfirm}
                                onChange={(event) => setPasswordConfirm(event.target.value)}
                                autoComplete="new-password"
                                disabled={submitting}
                            />
                            {passwordConfirm && password !== passwordConfirm && (
                                <p className="px-1 text-xs text-danger">비밀번호가 서로 다릅니다.</p>
                            )}
                        </div>

                        {error && (
                            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger">
                                {error}
                            </p>
                        )}

                        <Button type="submit" className="h-10 w-full" disabled={!canSubmit}>
                            {submitting ? '가입 처리 중...' : '계정 만들기'}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
