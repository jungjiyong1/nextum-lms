import React from 'react';
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
        <div className="min-h-screen flex items-center justify-center bg-[#1a1f2c] p-4">
            <div className="w-full max-w-sm">
                <div className="bg-[#242b3d] rounded-2xl shadow-2xl p-8 border border-white/5">
                    <div className="text-center mb-8">
                        <div className="w-16 h-16 bg-amber-500/20 rounded-xl flex items-center justify-center mx-auto mb-4">
                            <Building2 className="w-8 h-8 text-amber-400" aria-hidden="true" />
                        </div>
                        <h1 className="text-xl font-bold text-white mb-2">학원이 지정되지 않았습니다</h1>
                        <p className="text-gray-400 text-sm leading-relaxed">
                            관리자에게 문의해 학원 배정을 완료한 뒤 다시 로그인하세요.
                        </p>
                    </div>

                    {userEmail && (
                        <div className="bg-[#1a1f2c] rounded-lg p-3 mb-6">
                            <p className="text-gray-400 text-xs mb-1">로그인된 계정</p>
                            <p className="text-white text-sm font-medium truncate">{userEmail}</p>
                        </div>
                    )}

                    <Button
                        onClick={handleSignOut}
                        variant="outline"
                        className="w-full h-10 bg-transparent border-white/20 text-white hover:bg-white/10 hover:border-white/30 font-medium transition-all duration-200"
                    >
                        <LogOut className="w-4 h-4 mr-2" aria-hidden="true" />
                        로그아웃
                    </Button>

                    <div className="mt-6 text-center">
                        <p className="text-gray-500 text-xs">© 2026 NEXTUM</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
