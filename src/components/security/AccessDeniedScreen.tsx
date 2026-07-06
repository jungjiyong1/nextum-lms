import { LogOut, ShieldAlert } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

interface AccessDeniedScreenProps {
    roleLabel?: string;
    userEmail?: string | null;
    onSignOut: () => void | Promise<void>;
}

export function AccessDeniedScreen({ roleLabel, userEmail, onSignOut }: AccessDeniedScreenProps) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
            <Card className="w-full max-w-sm">
                <CardContent className="p-8">
                    <div className="mb-8 text-center">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-danger-soft">
                            <ShieldAlert className="h-8 w-8 text-danger" aria-hidden="true" />
                        </div>
                        <h1 className="mb-2 text-xl font-semibold text-foreground">운영 화면 접근 권한이 없습니다</h1>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                            현재 계정은 LMS 운영 화면을 사용할 수 없습니다. 학생 계정은 채점앱에서 학습 기능을 사용하세요.
                        </p>
                    </div>

                    {(roleLabel || userEmail) && (
                        <div className="mb-6 rounded-xl bg-muted p-3">
                            {userEmail && (
                                <>
                                    <p className="mb-1 text-xs text-muted-foreground">로그인된 계정</p>
                                    <p className="truncate text-sm font-medium text-foreground">{userEmail}</p>
                                </>
                            )}
                            {roleLabel && (
                                <p className="mt-2 text-xs text-muted-foreground">
                                    현재 권한: <span className="text-foreground">{roleLabel}</span>
                                </p>
                            )}
                        </div>
                    )}

                    <Button type="button" onClick={onSignOut} variant="outline" className="h-10 w-full">
                        <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                        로그아웃
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
