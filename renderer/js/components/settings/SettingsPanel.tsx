import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { toast } from 'sonner';
import { ShieldCheck, Lock, Trash2, AlertTriangle } from 'lucide-react';
import { emitDataChange } from '../../core/events';
import { useAuth } from '../../contexts/AuthContext';
import { PinSetupDialog } from '../security/PinSetupDialog';
import { PasswordConfirmDialog } from '../security/PasswordConfirmDialog';
import { pinApi } from '../../core/api';
import * as api from '../../core/api';

export function SettingsPanel() {
    const [loading, setLoading] = useState(false);
    const { user, hasPin, idleTimeout, refreshPinStatus, setLocked } = useAuth();

    // PIN Dialog state
    const [pinDialogOpen, setPinDialogOpen] = useState(false);
    const [pinMode, setPinMode] = useState<'setup' | 'change' | 'remove'>('setup');
    const [currentTimeout, setCurrentTimeout] = useState(idleTimeout);

    // Password confirmation dialog state
    const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
    const [pendingReset, setPendingReset] = useState<{
        label: string;
        action: () => Promise<unknown>;
        eventScope?: string | string[];
    } | null>(null);

    // Sync timeout from context
    useEffect(() => {
        setCurrentTimeout(idleTimeout);
    }, [idleTimeout]);

    // Open password confirmation dialog for reset
    const requestReset = (
        label: string,
        action: () => Promise<unknown>,
        eventScope?: string | string[]
    ) => {
        setPendingReset({ label, action, eventScope });
        setPasswordDialogOpen(true);
    };

    // Execute reset after password confirmation
    const executeReset = async () => {
        if (!pendingReset) return;

        const { label, action, eventScope } = pendingReset;
        setLoading(true);
        try {
            await action();
            if (typeof eventScope === 'string') {
                emitDataChange(eventScope as any);
            } else if (Array.isArray(eventScope)) {
                eventScope.forEach(scope => emitDataChange(scope as any));
            }
            toast.success(`${label} 초기화 완료`);
        } catch (error) {
            console.error(error);
            toast.error(`${label} 초기화 실패`);
        } finally {
            setLoading(false);
            setPendingReset(null);
        }
    };

    // PIN handlers
    const handleSetPin = async (newPin: string) => {
        if (!user?.id) throw new Error('User not found');
        await pinApi.setPin(user.id, newPin);
        await refreshPinStatus();
        toast.success(hasPin ? 'PIN이 변경되었습니다.' : 'PIN이 설정되었습니다.');
    };

    const handleVerifyPin = async (pin: string): Promise<boolean> => {
        if (!user?.id) return false;
        return await pinApi.verifyPin(user.id, pin);
    };

    const handleRemovePin = async () => {
        if (!user?.id) throw new Error('User not found');
        await pinApi.removePin(user.id);
        await refreshPinStatus();
        toast.success('PIN이 삭제되었습니다.');
    };

    const handleTimeoutChange = async (value: string) => {
        const minutes = parseInt(value);
        if (!user?.id) return;

        try {
            await pinApi.setIdleTimeout(user.id, minutes);
            setCurrentTimeout(minutes);
            await refreshPinStatus();
            toast.success(`비활성 타임아웃이 ${minutes}분으로 설정되었습니다.`);
        } catch (error) {
            console.error(error);
            toast.error('설정 저장 실패');
        }
    };

    const openPinDialog = (mode: 'setup' | 'change' | 'remove') => {
        setPinMode(mode);
        setPinDialogOpen(true);
    };

    return (
        <div className="container max-w-4xl mx-auto py-8 space-y-8">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">설정</h2>
                <p className="text-muted-foreground">애플리케이션 환경 설정 및 데이터 관리</p>
            </div>

            <div className="grid gap-6">
                {/* Security Settings */}
                <Card className="border-primary/30">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ShieldCheck className="w-5 h-5 text-primary" />
                            보안 설정
                        </CardTitle>
                        <CardDescription>
                            화면 잠금 PIN을 설정하여 앱을 보호하세요.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* PIN Status & Actions */}
                        <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
                            <div className="flex items-center gap-3">
                                <Lock className="w-5 h-5 text-muted-foreground" />
                                <div>
                                    <p className="font-medium">화면 잠금 PIN</p>
                                    <p className="text-sm text-muted-foreground">
                                        {hasPin ? 'PIN이 설정되어 있습니다.' : 'PIN이 설정되지 않았습니다.'}
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                {hasPin ? (
                                    <>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => openPinDialog('change')}
                                        >
                                            PIN 변경
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="text-destructive hover:bg-destructive hover:text-white"
                                            onClick={() => openPinDialog('remove')}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </>
                                ) : (
                                    <Button
                                        variant="default"
                                        size="sm"
                                        onClick={() => openPinDialog('setup')}
                                    >
                                        PIN 설정
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Idle Timeout Setting */}
                        {hasPin && (
                            <div className="flex items-center justify-between p-4 border rounded-lg">
                                <div>
                                    <p className="font-medium">비활성 타임아웃</p>
                                    <p className="text-sm text-muted-foreground">
                                        지정된 시간 동안 미사용 시 화면이 잠깁니다.
                                    </p>
                                </div>
                                <Select
                                    value={String(currentTimeout)}
                                    onValueChange={handleTimeoutChange}
                                >
                                    <SelectTrigger className="w-32">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="5">5분</SelectItem>
                                        <SelectItem value="10">10분</SelectItem>
                                        <SelectItem value="15">15분</SelectItem>
                                        <SelectItem value="30">30분</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {/* Lock Now Button */}
                        {hasPin && (
                            <div className="flex items-center justify-between p-4 border rounded-lg border-primary/30 bg-primary/5">
                                <div>
                                    <p className="font-medium">바로 잠금</p>
                                    <p className="text-sm text-muted-foreground">
                                        화면을 즉시 잠금 상태로 전환합니다.
                                    </p>
                                </div>
                                <Button
                                    variant="default"
                                    size="sm"
                                    onClick={() => setLocked(true)}
                                >
                                    <Lock className="w-4 h-4 mr-2" />
                                    지금 잠금
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* General Settings - UI Only (Disabled) */}
                <Card className="opacity-60">
                    <CardHeader>
                        <CardTitle>일반 설정</CardTitle>
                        <CardDescription>
                            Supabase 마이그레이션 이후 일반 설정 기능이 비활성화되었습니다.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex items-center justify-between space-x-2">
                            <div className="space-y-1">
                                <Label htmlFor="auto-migrate" className="text-muted-foreground">자동 마이그레이션</Label>
                                <p className="text-sm text-muted-foreground">
                                    앱 시작 시 스키마 변경사항을 자동으로 반영합니다.
                                </p>
                            </div>
                            <Switch
                                id="auto-migrate"
                                checked={false}
                                disabled={true}
                            />
                        </div>
                        <div className="flex items-center justify-between space-x-2 pt-4 border-t">
                            <div className="space-y-1">
                                <Label className="text-muted-foreground">마이그레이션 수동 실행</Label>
                                <p className="text-sm text-muted-foreground">
                                    Supabase 대시보드에서 마이그레이션을 관리합니다.
                                </p>
                            </div>
                            <Button variant="default" disabled={true}>
                                비활성화됨
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* Danger Zone */}
                <Card className="border-destructive/50">
                    <CardHeader>
                        <CardTitle className="text">데이터 초기화</CardTitle>
                        <CardDescription>
                            주의: 초기화된 데이터는 복구할 수 없습니다. 신중하게 실행해주세요.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">

                        <ResetItem
                            label="강의실/도면"
                            desc="강의실 배치, 도면, 관련 타임테이블 삭제"
                            onReset={() => requestReset('강의실', api.resetClassrooms, ['classrooms', 'lessons', 'schedules', 'enrollments'])}
                            loading={loading}
                        />
                        <ResetItem
                            label="수업/강의"
                            desc="수업 기본 정보 및 스케줄 삭제"
                            onReset={() => requestReset('수업', api.resetLessons, ['lessons', 'schedules', 'enrollments'])}
                            loading={loading}
                        />
                        <ResetItem
                            label="일정 (Schedule)"
                            desc="수업 일정(lesson_schedules)만 삭제"
                            onReset={() => requestReset('일정', api.resetSchedules, ['schedules'])}
                            loading={loading}
                        />
                        <ResetItem
                            label="강사"
                            desc="강사 정보 및 배정 데이터 삭제"
                            onReset={() => requestReset('강사', api.resetInstructors, ['instructors', 'lessons'])}
                            loading={loading}
                        />
                        <ResetItem
                            label="학생"
                            desc="학생 정보, 수강 이력, 결제 내역 삭제"
                            onReset={() => requestReset('학생', api.resetStudents, ['students', 'enrollments', 'accounting'])}
                            loading={loading}
                        />
                        <ResetItem
                            label="과목"
                            desc="과목/코스 데이터 삭제"
                            onReset={() => requestReset('과목', api.resetCourses, ['lessons'])}
                            loading={loading}
                        />
                        <ResetItem
                            label="수강 등록"
                            desc="학생-수업 연결 데이터 삭제"
                            onReset={() => requestReset('수강 등록', api.resetEnrollments, ['enrollments'])}
                            loading={loading}
                        />
                        <ResetItem
                            label="회계"
                            desc="수입/지출/급여 데이터 삭제"
                            onReset={() => requestReset('회계', api.resetAccounting, ['accounting'])}
                            loading={loading}
                        />
                        <div className="pt-4 mt-4 border-t border-destructive/20">
                            <ResetItem
                                label="전체 시스템"
                                desc="모든 데이터를 삭제하고 초기 상태로 되돌립니다."
                                onReset={() => requestReset('전체 시스템', api.resetAll, ['general'])}
                                loading={loading}
                                variant="destructive"
                            />
                        </div>

                    </CardContent>
                </Card>
            </div>

            {/* PIN Setup Dialog */}
            <PinSetupDialog
                open={pinDialogOpen}
                onOpenChange={setPinDialogOpen}
                hasExistingPin={hasPin}
                onSetPin={handleSetPin}
                onVerifyCurrentPin={handleVerifyPin}
                onRemovePin={handleRemovePin}
                mode={pinMode}
            />

            {/* Password Confirmation Dialog for Dangerous Operations */}
            <PasswordConfirmDialog
                open={passwordDialogOpen}
                onOpenChange={(open) => {
                    setPasswordDialogOpen(open);
                    if (!open) setPendingReset(null);
                }}
                title={`${pendingReset?.label || ''} 초기화`}
                description={`이 작업은 되돌릴 수 없습니다. 계속하려면 비밀번호를 입력하세요.`}
                confirmLabel="초기화 실행"
                onConfirm={executeReset}
            />
        </div>
    );
}

function ResetItem({
    label,
    desc,
    onReset,
    loading,
    variant = "destructive-outline"
}: {
    label: string;
    desc: string;
    onReset: () => void;
    loading: boolean;
    variant?: "destructive" | "destructive-outline"
}) {
    return (
        <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors">
            <div className="space-y-0.5">
                <label className="text-sm font-medium leading-none">{label}</label>
                <p className="text-xs text-muted-foreground">{desc}</p>
            </div>
            <Button
                variant={variant === "destructive" ? "destructive" : "outline"}
                size="sm"
                onClick={onReset}
                disabled={loading}
                className={variant === "destructive-outline" ? "text-destructive hover:bg-destructive hover:text-white border-destructive/50" : ""}
            >
                초기화
            </Button>
        </div>
    );
}
