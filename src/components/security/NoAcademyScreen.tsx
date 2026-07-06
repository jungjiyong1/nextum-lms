import { Building2, LogOut } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';

interface NoAcademyScreenProps {
    userEmail?: string | null;
}

export function NoAcademyScreen({ userEmail }: NoAcademyScreenProps) {
    const { signOut } = useAuth();

    const handleSignOut = async () => {
        await signOut();
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-[#1a1f2c] p-4">
            <div className="w-full max-w-sm rounded-2xl border border-white/5 bg-[#242b3d] p-8 shadow-2xl">
                <div className="mb-8 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-amber-500/20">
                        <Building2 className="h-8 w-8 text-amber-400" aria-hidden="true" />
                    </div>
                    <h1 className="mb-2 text-xl font-bold text-white">학원이 지정되지 않았습니다</h1>
                    <p className="text-sm leading-relaxed text-gray-400">
                        관리자에게 문의해 학원 배정을 완료한 뒤 다시 로그인하세요.
                    </p>
                </div>

                {userEmail && (
                    <div className="mb-6 rounded-lg bg-[#1a1f2c] p-3">
                        <p className="mb-1 text-xs text-gray-400">로그인된 계정</p>
                        <p className="truncate text-sm font-medium text-white">{userEmail}</p>
                    </div>
                )}

                <Button
                    type="button"
                    onClick={handleSignOut}
                    variant="outline"
                    className="h-10 w-full border-white/20 bg-transparent font-medium text-white transition-all duration-200 hover:border-white/30 hover:bg-white/10"
                >
                    <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                    로그아웃
                </Button>

                <div className="mt-6 text-center">
                    <p className="text-xs text-gray-500">© 2026 NEXTUM</p>
                </div>
            </div>
        </div>
    );
}
