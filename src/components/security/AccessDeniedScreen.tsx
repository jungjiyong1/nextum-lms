import { LogOut, ShieldAlert } from 'lucide-react';
import { Button } from '../ui/button';

interface AccessDeniedScreenProps {
    roleLabel?: string;
    userEmail?: string | null;
    onSignOut: () => void | Promise<void>;
}

export function AccessDeniedScreen({ roleLabel, userEmail, onSignOut }: AccessDeniedScreenProps) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-[#1a1f2c] p-4">
            <div className="w-full max-w-sm rounded-2xl border border-white/5 bg-[#242b3d] p-8 shadow-2xl">
                <div className="mb-8 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-red-500/20">
                        <ShieldAlert className="h-8 w-8 text-red-300" aria-hidden="true" />
                    </div>
                    <h1 className="mb-2 text-xl font-bold text-white">운영 화면 접근 권한이 없습니다</h1>
                    <p className="text-sm leading-relaxed text-gray-400">
                        현재 계정은 LMS 운영자 화면을 사용할 수 없습니다. 학생 계정은 채점앱에서 학습 기능을 사용하세요.
                    </p>
                </div>

                {(roleLabel || userEmail) && (
                    <div className="mb-6 rounded-lg bg-[#1a1f2c] p-3">
                        {userEmail && (
                            <>
                                <p className="mb-1 text-xs text-gray-400">로그인된 계정</p>
                                <p className="truncate text-sm font-medium text-white">{userEmail}</p>
                            </>
                        )}
                        {roleLabel && (
                            <p className="mt-2 text-xs text-gray-400">
                                현재 권한: <span className="text-gray-200">{roleLabel}</span>
                            </p>
                        )}
                    </div>
                )}

                <Button
                    type="button"
                    onClick={onSignOut}
                    variant="outline"
                    className="h-10 w-full border-white/20 bg-transparent font-medium text-white transition-all duration-200 hover:border-white/30 hover:bg-white/10"
                >
                    <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                    로그아웃
                </Button>
            </div>
        </div>
    );
}
