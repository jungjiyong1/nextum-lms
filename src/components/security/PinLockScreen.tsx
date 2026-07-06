import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

interface PinLockScreenProps {
    onUnlock: () => void;
    onVerify: (pin: string) => Promise<boolean>;
    userEmail?: string | null;
}

export function PinLockScreen({ onUnlock, onVerify, userEmail }: PinLockScreenProps) {
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPin, setShowPin] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (pin.length < 4) {
            setError('PIN은 4자리 이상이어야 합니다.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const isValid = await onVerify(pin);
            if (isValid) {
                onUnlock();
            } else {
                setError('PIN이 올바르지 않습니다.');
                setPin('');
                inputRef.current?.focus();
            }
        } catch {
            setError('오류가 발생했습니다. 다시 시도해주세요.');
        } finally {
            setLoading(false);
        }
    };

    const handlePinChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setPin(event.target.value.replace(/\D/g, ''));
        setError('');
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
            <Card className="w-full max-w-sm">
                <CardContent className="p-8">
                    <div className="mb-8 text-center">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                            <Lock className="h-8 w-8" />
                        </div>
                        <h1 className="mb-2 text-xl font-semibold text-foreground">화면 잠금</h1>
                        {userEmail && <p className="text-sm text-muted-foreground">{userEmail}</p>}
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="pin" className="pl-1 text-xs font-medium">
                                PIN
                            </Label>
                            <div className="relative">
                                <Input
                                    ref={inputRef}
                                    id="pin"
                                    type={showPin ? 'text' : 'password'}
                                    value={pin}
                                    onChange={handlePinChange}
                                    placeholder="PIN 입력"
                                    className="h-10 pr-10 text-center font-medium tracking-widest"
                                    maxLength={10}
                                    autoComplete="off"
                                    disabled={loading}
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setShowPin(!showPin)}
                                    className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                                    aria-label={showPin ? 'PIN 숨기기' : 'PIN 보기'}
                                >
                                    {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </Button>
                            </div>
                            {error && <p className="mt-2 text-center text-sm text-danger">{error}</p>}
                        </div>

                        <Button type="submit" className="mt-2 h-10 w-full" disabled={loading || pin.length < 4}>
                            {loading ? '확인 중...' : '잠금 해제'}
                        </Button>
                    </form>

                    <div className="mt-6 text-center">
                        <p className="text-xs text-muted-foreground">© 2026 NEXTUM</p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
