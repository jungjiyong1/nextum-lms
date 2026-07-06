import { Building2, LogOut } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

interface NoAcademyScreenProps {
    userEmail?: string | null;
}

export function NoAcademyScreen({ userEmail }: NoAcademyScreenProps) {
    const { signOut } = useAuth();

    const handleSignOut = async () => {
        await signOut();
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
            <Card className="w-full max-w-sm">
                <CardContent className="p-8">
                    <div className="mb-8 text-center">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-warning-soft">
                            <Building2 className="h-8 w-8 text-warning" aria-hidden="true" />
                        </div>
                        <h1 className="mb-2 text-xl font-semibold text-foreground">학원이 지정되지 않았습니다</h1>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                            관리자에게 문의해 학원 배정을 완료한 뒤 다시 로그인하세요.
                        </p>
                    </div>

                    {userEmail && (
                        <div className="mb-6 rounded-xl bg-muted p-3">
                            <p className="mb-1 text-xs text-muted-foreground">로그인된 계정</p>
                            <p className="truncate text-sm font-medium text-foreground">{userEmail}</p>
                        </div>
                    )}

                    <Button type="button" onClick={handleSignOut} variant="outline" className="h-10 w-full">
                        <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                        로그아웃
                    </Button>

                    <div className="mt-6 text-center">
                        <p className="text-xs text-muted-foreground">© 2026 NEXTUM</p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
