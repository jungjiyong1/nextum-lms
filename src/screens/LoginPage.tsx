import React, { useState } from 'react';
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
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!email.trim() || !password) {
            toast.error('아이디와 비밀번호를 입력해주세요.');
            return;
        }

        const loginEmail = resolveLoginEmail(email);
        setIsSubmitting(true);

        try {
            const { error } = await signIn(loginEmail, password);

            if (error) {
                console.error('Login error:', error);
                toast.error('로그인 실패: 아이디 또는 비밀번호가 올바르지 않습니다.');
            } else {
                toast.success('로그인되었습니다.');
            }
        } catch (err) {
            console.error('Unexpected error:', err);
            toast.error('예기치 않은 오류가 발생했습니다.');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#1a1f2c]">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-[#1ea362] border-t-transparent rounded-full animate-spin" />
                    <p className="text-white/70">로딩 중...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#1a1f2c] p-4">
            <div className="w-full max-w-sm">
                <div className="bg-[#242b3d] rounded-2xl shadow-2xl p-8 border border-white/5">
                    <div className="text-center mb-8">
                        <div className="w-16 h-16 bg-[#1ea362] rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-[#1ea362]/20">
                            <BookOpen className="w-8 h-8 text-white" aria-hidden="true" />
                        </div>
                        <h1 className="text-xl font-bold text-white mb-2">NEXTUM LMS</h1>
                        <p className="text-gray-400 text-sm">
                            계정으로 로그인하세요
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="email" className="text-gray-300 text-xs font-medium pl-1">
                                아이디
                            </Label>
                            <Input
                                id="email"
                                type="text"
                                placeholder="아이디 또는 이메일"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="bg-[#e8e8e8] border-transparent text-slate-900 placeholder:text-gray-400 focus:bg-white focus:border-[#1ea362] focus:ring-[#1ea362]/30 h-10 text-sm font-medium"
                                autoComplete="username"
                                disabled={isSubmitting}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="password" className="text-gray-300 text-xs font-medium pl-1">
                                비밀번호
                            </Label>
                            <Input
                                id="password"
                                type="password"
                                placeholder="비밀번호"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="bg-[#e8e8e8] border-transparent text-slate-900 placeholder:text-gray-400 focus:bg-white focus:border-[#1ea362] focus:ring-[#1ea362]/30 h-10 text-sm font-medium"
                                autoComplete="current-password"
                                disabled={isSubmitting}
                            />
                        </div>

                        <Button
                            type="submit"
                            className="w-full h-10 bg-[#1ea362] hover:bg-[#188f54] text-white font-medium shadow-lg shadow-[#1ea362]/30 transition-all duration-200 mt-2"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? (
                                <div className="flex items-center gap-2">
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    로그인 중...
                                </div>
                            ) : (
                                '로그인'
                            )}
                        </Button>
                    </form>

                    <div className="mt-4 text-center">
                        <p className="text-gray-500 text-xs">© 2026 NEXTUM</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
