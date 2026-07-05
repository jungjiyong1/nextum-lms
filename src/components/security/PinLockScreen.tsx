import React, { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Lock, Eye, EyeOff } from 'lucide-react';

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

    // 자동 포커스
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
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
        } catch (err) {
            setError('오류가 발생했습니다. 다시 시도해주세요.');
        } finally {
            setLoading(false);
        }
    };

    const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value.replace(/\D/g, ''); // 숫자만 허용
        setPin(value);
        setError('');
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#1a1f2c] p-4">
            {/* Background decoration */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -right-40 w-96 h-96 bg-[#1ea362]/10 rounded-full blur-3xl opacity-50" />
                <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-[#1ea362]/5 rounded-full blur-3xl opacity-50" />
            </div>

            {/* Lock Card */}
            <div className="relative w-full max-w-sm">
                <div className="bg-[#242b3d] rounded-2xl shadow-2xl p-8 border border-white/5">
                    {/* Logo & Title */}
                    <div className="text-center mb-8">
                        <div className="w-16 h-16 bg-[#1ea362] rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-[#1ea362]/20">
                            <Lock className="w-8 h-8 text-white" />
                        </div>
                        <h1 className="text-xl font-bold text-white mb-2">화면 잠금</h1>
                        {userEmail && (
                            <p className="text-gray-400 text-sm">{userEmail}</p>
                        )}
                    </div>

                    {/* PIN Form */}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="pin" className="text-gray-300 text-xs font-medium pl-1">
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
                                    className="bg-[#e8e8e8] border-transparent text-slate-900 placeholder:text-gray-400 focus:bg-white focus:border-[#1ea362] focus:ring-[#1ea362]/30 h-10 text-sm font-medium text-center tracking-widest pr-10"
                                    maxLength={10}
                                    autoComplete="off"
                                    disabled={loading}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPin(!showPin)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 bg-transparent border-none outline-none focus:outline-none p-0"
                                >
                                    {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                            {error && (
                                <p className="text-sm text-red-400 text-center mt-2">{error}</p>
                            )}
                        </div>

                        <Button
                            type="submit"
                            className="w-full h-10 bg-[#1ea362] hover:bg-[#188f54] text-white font-medium shadow-lg shadow-[#1ea362]/30 transition-all duration-200 mt-2"
                            disabled={loading || pin.length < 4}
                        >
                            {loading ? (
                                <div className="flex items-center gap-2">
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    확인 중...
                                </div>
                            ) : (
                                '잠금 해제'
                            )}
                        </Button>
                    </form>

                    {/* Footer */}
                    <div className="mt-6 text-center">
                        <p className="text-gray-500 text-xs">
                            © 2026 NEXTUM
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
