import React, { useState } from 'react';
import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

function resolveLoginEmail(identifier: string): string {
  const value = identifier.trim();
  if (value.includes('@')) return value;
  const domain = process.env.NEXT_PUBLIC_LMS_LOGIN_EMAIL_DOMAIN
    || process.env.LMS_LOGIN_EMAIL_DOMAIN
    || 'nextum.local';
  return `${value}@${domain}`;
}

export function LoginPage() {
  const { signIn, loading } = useAuth();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!loginId.trim() || !password) {
      toast.error('아이디와 비밀번호를 입력하세요.');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await signIn(resolveLoginEmail(loginId), password);
      if (error) {
        console.error('Login error:', error);
        toast.error('로그인 실패: 아이디 또는 비밀번호를 확인하세요.');
      } else {
        toast.success('로그인되었습니다.');
      }
    } catch (err) {
      console.error('Unexpected login error:', err);
      toast.error('예상하지 못한 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#1a1f2c]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#1ea362] border-t-transparent" />
          <p className="text-white/70">로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1a1f2c] p-4">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-white/5 bg-[#242b3d] p-8 shadow-2xl">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-[#1ea362] shadow-lg shadow-[#1ea362]/20">
              <BookOpen className="h-8 w-8 text-white" aria-hidden="true" />
            </div>
            <h1 className="mb-2 text-xl font-bold text-white">NEXTUM LMS</h1>
            <p className="text-sm text-gray-400">아이디로 로그인하세요</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="login-id" className="pl-1 text-xs font-medium text-gray-300">
                아이디
              </Label>
              <Input
                id="login-id"
                type="text"
                placeholder="아이디"
                value={loginId}
                onChange={(event) => setLoginId(event.target.value)}
                className="h-10 border-transparent bg-[#e8e8e8] text-sm font-medium text-slate-900 placeholder:text-gray-400 focus:border-[#1ea362] focus:bg-white focus:ring-[#1ea362]/30"
                autoComplete="username"
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="pl-1 text-xs font-medium text-gray-300">
                비밀번호
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="비밀번호"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-10 border-transparent bg-[#e8e8e8] text-sm font-medium text-slate-900 placeholder:text-gray-400 focus:border-[#1ea362] focus:bg-white focus:ring-[#1ea362]/30"
                autoComplete="current-password"
                disabled={isSubmitting}
              />
            </div>

            <Button
              type="submit"
              className="mt-2 h-10 w-full bg-[#1ea362] font-medium text-white shadow-lg shadow-[#1ea362]/30 transition-all duration-200 hover:bg-[#188f54]"
              disabled={isSubmitting}
            >
              {isSubmitting ? '로그인 중...' : '로그인'}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <Link href="/signup" className="text-xs text-gray-400 hover:text-white">초대코드로 학생 가입</Link>
          </div>
          <div className="mt-3 text-center">
            <p className="text-xs text-gray-500">© 2026 NEXTUM</p>
          </div>
        </div>
      </div>
    </div>
  );
}
