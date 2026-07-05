import React, { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '../../core/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';

interface PasswordConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    confirmLabel?: string;
    onConfirm: () => void | Promise<void>;
}

export function PasswordConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmLabel = '확인',
    onConfirm
}: PasswordConfirmDialogProps) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const { user } = useAuth();

    // 다이얼로그 열릴 때 포커스 및 초기화
    useEffect(() => {
        if (open) {
            setPassword('');
            setError('');
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [open]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!password) {
            setError('비밀번호를 입력해주세요.');
            return;
        }

        if (!user?.email) {
            setError('사용자 정보를 찾을 수 없습니다.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            // Supabase로 비밀번호 재인증
            const { error: authError } = await supabase.auth.signInWithPassword({
                email: user.email,
                password: password
            });

            if (authError) {
                setError('비밀번호가 올바르지 않습니다.');
                setPassword('');
                inputRef.current?.focus();
                return;
            }

            // 비밀번호 확인 성공 - 콜백 실행
            await onConfirm();
            onOpenChange(false);
        } catch (err) {
            console.error('Password verification error:', err);
            setError('인증 중 오류가 발생했습니다.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-destructive">
                        <AlertTriangle className="w-5 h-5" />
                        {title}
                    </DialogTitle>
                    <DialogDescription className="pt-2">
                        {description}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="password" className="text-sm font-medium">
                            계속하려면 비밀번호를 입력하세요
                        </Label>
                        <Input
                            ref={inputRef}
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => {
                                setPassword(e.target.value);
                                setError('');
                            }}
                            placeholder="비밀번호"
                            className="w-full"
                            disabled={loading}
                            autoComplete="current-password"
                        />
                        {error && (
                            <p className="text-sm text-destructive">{error}</p>
                        )}
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={loading}
                        >
                            취소
                        </Button>
                        <Button
                            type="submit"
                            variant="destructive"
                            disabled={loading || !password}
                        >
                            {loading ? '확인 중...' : confirmLabel}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
