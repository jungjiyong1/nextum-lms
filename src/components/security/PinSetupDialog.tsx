import React, { useState, useRef, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';

interface PinSetupDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    hasExistingPin: boolean;
    onSetPin: (newPin: string) => Promise<void>;
    onVerifyCurrentPin: (pin: string) => Promise<boolean>;
    onRemovePin: () => Promise<void>;
    mode: 'setup' | 'change' | 'remove';
}

export function PinSetupDialog({
    open,
    onOpenChange,
    hasExistingPin,
    onSetPin,
    onVerifyCurrentPin,
    onRemovePin,
    mode,
}: PinSetupDialogProps) {
    const [currentPin, setCurrentPin] = useState('');
    const [newPin, setNewPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [showCurrentPin, setShowCurrentPin] = useState(false);
    const [showNewPin, setShowNewPin] = useState(false);
    const [step, setStep] = useState<'verify' | 'input'>('verify');

    const currentPinRef = useRef<HTMLInputElement>(null);
    const newPinRef = useRef<HTMLInputElement>(null);

    // 다이얼로그 열릴 때 초기화
    useEffect(() => {
        if (open) {
            setCurrentPin('');
            setNewPin('');
            setConfirmPin('');
            setError('');
            setStep(hasExistingPin ? 'verify' : 'input');
        }
    }, [open, hasExistingPin]);

    // 포커스 관리
    useEffect(() => {
        if (open) {
            setTimeout(() => {
                if (step === 'verify') {
                    currentPinRef.current?.focus();
                } else {
                    newPinRef.current?.focus();
                }
            }, 100);
        }
    }, [open, step]);

    const handleVerifyCurrentPin = async () => {
        if (currentPin.length < 4) {
            setError('PIN은 4자리 이상이어야 합니다.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const isValid = await onVerifyCurrentPin(currentPin);
            if (isValid) {
                if (mode === 'remove') {
                    await onRemovePin();
                    onOpenChange(false);
                } else {
                    setStep('input');
                }
            } else {
                setError('현재 PIN이 올바르지 않습니다.');
            }
        } catch {
            setError('오류가 발생했습니다.');
        } finally {
            setLoading(false);
        }
    };

    const handleSetNewPin = async () => {
        if (newPin.length < 4) {
            setError('PIN은 4자리 이상이어야 합니다.');
            return;
        }
        if (newPin !== confirmPin) {
            setError('PIN이 일치하지 않습니다.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            await onSetPin(newPin);
            onOpenChange(false);
        } catch {
            setError('PIN 설정 중 오류가 발생했습니다.');
        } finally {
            setLoading(false);
        }
    };

    const handlePinInput = (value: string, setter: (v: string) => void) => {
        setter(value.replace(/\D/g, '')); // 숫자만 허용
        setError('');
    };

    const getTitle = () => {
        switch (mode) {
            case 'setup': return 'PIN 설정';
            case 'change': return 'PIN 변경';
            case 'remove': return 'PIN 삭제';
        }
    };

    const getDescription = () => {
        switch (mode) {
            case 'setup': return '화면 잠금에 사용할 PIN을 설정하세요.';
            case 'change': return '새로운 PIN으로 변경합니다.';
            case 'remove': return 'PIN을 삭제하면 화면 잠금이 비활성화됩니다.';
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-primary" />
                        {getTitle()}
                    </DialogTitle>
                    <DialogDescription>
                        {getDescription()}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* 현재 PIN 확인 단계 */}
                    {step === 'verify' && hasExistingPin && (
                        <div className="space-y-2">
                            <Label htmlFor="current-pin">현재 PIN</Label>
                            <div className="relative">
                                <Input
                                    ref={currentPinRef}
                                    id="current-pin"
                                    type={showCurrentPin ? 'text' : 'password'}
                                    value={currentPin}
                                    onChange={(e) => handlePinInput(e.target.value, setCurrentPin)}
                                    placeholder="현재 PIN 입력"
                                    maxLength={10}
                                    autoComplete="off"
                                    disabled={loading}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowCurrentPin(!showCurrentPin)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                >
                                    {showCurrentPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* 새 PIN 입력 단계 */}
                    {step === 'input' && mode !== 'remove' && (
                        <>
                            <div className="space-y-2">
                                <Label htmlFor="new-pin">새 PIN (4자리 이상)</Label>
                                <div className="relative">
                                    <Input
                                        ref={newPinRef}
                                        id="new-pin"
                                        type={showNewPin ? 'text' : 'password'}
                                        value={newPin}
                                        onChange={(e) => handlePinInput(e.target.value, setNewPin)}
                                        placeholder="새 PIN 입력"
                                        maxLength={10}
                                        autoComplete="off"
                                        disabled={loading}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowNewPin(!showNewPin)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    >
                                        {showNewPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="confirm-pin">PIN 확인</Label>
                                <Input
                                    id="confirm-pin"
                                    type="password"
                                    value={confirmPin}
                                    onChange={(e) => handlePinInput(e.target.value, setConfirmPin)}
                                    placeholder="PIN 다시 입력"
                                    maxLength={10}
                                    autoComplete="off"
                                    disabled={loading}
                                />
                            </div>
                        </>
                    )}

                    {error && (
                        <p className="text-sm text-destructive">{error}</p>
                    )}
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                        취소
                    </Button>
                    {step === 'verify' && (
                        <Button onClick={handleVerifyCurrentPin} disabled={loading || currentPin.length < 4}>
                            {loading ? '확인 중...' : mode === 'remove' ? 'PIN 삭제' : '다음'}
                        </Button>
                    )}
                    {step === 'input' && mode !== 'remove' && (
                        <Button onClick={handleSetNewPin} disabled={loading || newPin.length < 4}>
                            {loading ? '설정 중...' : 'PIN 설정'}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
