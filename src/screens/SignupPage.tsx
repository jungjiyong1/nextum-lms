'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function SignupPage() {
  const [inviteCode, setInviteCode] = useState('');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/lms/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode, loginId, password }),
      });
      const result = await response.json().catch(() => null) as { success?: boolean; error?: string } | null;
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || '가입 처리에 실패했습니다.');
      }
      setDone(true);
      toast.success('가입이 완료되었습니다.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '가입 처리에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1a1f2c] p-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/5 bg-[#242b3d] p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-[#1ea362] shadow-lg shadow-[#1ea362]/20">
            <BookOpen className="h-8 w-8 text-white" aria-hidden="true" />
          </div>
          <h1 className="mb-2 text-xl font-bold text-white">NEXTUM LMS</h1>
          <p className="text-sm text-gray-400">초대코드로 학생 계정을 만듭니다</p>
        </div>

        {done ? (
          <div className="space-y-4 text-center">
            <div className="rounded-lg bg-emerald-500/10 p-4 text-sm text-emerald-100">
              가입이 완료되었습니다. 선택한 아이디로 로그인할 수 있습니다.
            </div>
            <Link href="/login">
              <Button className="h-10 w-full bg-[#1ea362] text-white hover:bg-[#188f54]">로그인으로 이동</Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-code" className="pl-1 text-xs font-medium text-gray-300">초대코드</Label>
              <Input
                id="invite-code"
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value)}
                placeholder="NX-0000-0000-0000"
                autoComplete="one-time-code"
                className="h-10 border-transparent bg-[#e8e8e8] text-sm font-medium text-slate-900 placeholder:text-gray-400 focus:border-[#1ea362] focus:bg-white focus:ring-[#1ea362]/30"
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-id" className="pl-1 text-xs font-medium text-gray-300">아이디</Label>
              <Input
                id="login-id"
                value={loginId}
                onChange={(event) => setLoginId(event.target.value)}
                placeholder="영문, 숫자, . _ -"
                autoComplete="username"
                className="h-10 border-transparent bg-[#e8e8e8] text-sm font-medium text-slate-900 placeholder:text-gray-400 focus:border-[#1ea362] focus:bg-white focus:ring-[#1ea362]/30"
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="signup-password" className="pl-1 text-xs font-medium text-gray-300">비밀번호</Label>
              <Input
                id="signup-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="비밀번호"
                autoComplete="new-password"
                className="h-10 border-transparent bg-[#e8e8e8] text-sm font-medium text-slate-900 placeholder:text-gray-400 focus:border-[#1ea362] focus:bg-white focus:ring-[#1ea362]/30"
                disabled={isSubmitting}
              />
            </div>
            <Button
              type="submit"
              className="mt-2 h-10 w-full bg-[#1ea362] font-medium text-white shadow-lg shadow-[#1ea362]/30 hover:bg-[#188f54]"
              disabled={isSubmitting}
            >
              {isSubmitting ? '가입 처리 중...' : '가입하기'}
            </Button>
            <div className="text-center">
              <Link href="/login" className="text-xs text-gray-400 hover:text-white">이미 계정이 있으면 로그인</Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
