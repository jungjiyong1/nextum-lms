import React, { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';

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
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="p-8">
            <div className="mb-8 flex flex-col items-center">
              <Skeleton className="mb-4 h-16 w-16 rounded-xl" />
              <Skeleton className="mb-3 h-5 w-32" />
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-10 w-full" />
              </div>
              <Skeleton className="h-10 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="p-8">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <BookOpen className="h-8 w-8" aria-hidden="true" />
            </div>
            <h1 className="mb-2 text-xl font-semibold text-foreground">NEXTUM LMS</h1>
            <p className="text-sm text-muted-foreground">아이디로 로그인하세요</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="login-id" className="pl-1 text-xs font-medium">
                아이디
              </Label>
              <Input
                id="login-id"
                type="text"
                placeholder="아이디"
                value={loginId}
                onChange={(event) => setLoginId(event.target.value)}
                className="h-10"
                autoComplete="username"
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="pl-1 text-xs font-medium">
                비밀번호
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="비밀번호"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-10"
                autoComplete="current-password"
                disabled={isSubmitting}
              />
            </div>

            <Button type="submit" className="mt-2 h-10 w-full" disabled={isSubmitting}>
              {isSubmitting ? '로그인 중...' : '로그인'}
            </Button>
          </form>

          <div className="mt-3 text-center">
            <p className="text-xs text-muted-foreground">© 2026 NEXTUM</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
