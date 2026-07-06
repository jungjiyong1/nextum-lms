import React from 'react';
import Link from 'next/link';
import {
    Calculator,
    ClipboardList,
    GraduationCap,
    Home,
    LayoutGrid,
    LogOut,
    Settings,
    Users,
} from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { Profile } from '../../contexts/AuthContext';
import { appPageHref, canAccessAppPage, getRoleLabel, type AppPage } from '../../core/auth/roles';

interface SidebarProps {
    activePage: string;
    onNavigate: (page: string) => void;
    onSignOut?: () => void;
    userProfile?: Profile | null;
    academyName?: string | null;
}

const navItems: Array<{ id: AppPage; label: string; href: string; icon: React.ComponentType<{ size?: number }> }> = [
    { id: 'home', label: '홈', href: appPageHref.home, icon: Home },
    { id: 'assignments', label: '과제', href: appPageHref.assignments, icon: ClipboardList },
    { id: 'classrooms', label: '반/시간표', href: appPageHref.classrooms, icon: LayoutGrid },
    { id: 'instructors', label: '강사', href: appPageHref.instructors, icon: Users },
    { id: 'students', label: '학생', href: appPageHref.students, icon: GraduationCap },
    { id: 'accounting', label: '회계', href: appPageHref.accounting, icon: Calculator },
    { id: 'settings', label: '설정', href: appPageHref.settings, icon: Settings },
];

export function Sidebar({ activePage, onNavigate, onSignOut, userProfile, academyName }: SidebarProps) {
    const [collapsed, setCollapsed] = React.useState(false);
    const [compactViewport, setCompactViewport] = React.useState(false);
    const visibleNavItems = navItems.filter((item) => canAccessAppPage(userProfile?.role, item.id));
    const visuallyCollapsed = collapsed || compactViewport;

    React.useEffect(() => {
        const updateCompactViewport = () => {
            setCompactViewport(window.innerWidth < 768);
        };

        updateCompactViewport();
        window.addEventListener('resize', updateCompactViewport);
        return () => window.removeEventListener('resize', updateCompactViewport);
    }, []);

    return (
        <aside
            className={cn(
                'flex h-screen shrink-0 flex-col overflow-hidden border-r border-border bg-card transition-[width] duration-200',
                visuallyCollapsed ? 'w-16' : 'w-[220px]',
            )}
        >
            <Button
                type="button"
                variant="ghost"
                className={cn(
                    'h-auto w-full justify-start gap-3 rounded-none border-b border-border px-3 py-4 hover:bg-primary-soft/50',
                    visuallyCollapsed && 'justify-center px-2',
                )}
                onClick={() => setCollapsed(!collapsed)}
                title={visuallyCollapsed ? '메뉴 열기' : '메뉴 닫기'}
            >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary-soft text-primary-strong">
                    <img src="/icon.png" alt="NEXTUM LMS" className="h-8 w-8 rounded-xl" />
                </span>
                {!visuallyCollapsed && (
                    <span className="min-w-0 truncate text-left text-base font-semibold text-foreground">
                        {academyName || 'NEXTUM LMS'}
                    </span>
                )}
            </Button>

            <nav className="flex flex-1 flex-col gap-1 px-2 py-3">
                {visibleNavItems.map((item) => (
                    <Link
                        key={item.id}
                        href={item.href}
                        className={cn(
                            'flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-primary-soft/50 hover:text-foreground',
                            activePage === item.id && 'bg-primary-soft text-primary-strong',
                            visuallyCollapsed && 'justify-center px-2',
                        )}
                        onClick={() => onNavigate(item.id)}
                        title={visuallyCollapsed ? item.label : undefined}
                    >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                            <item.icon size={20} />
                        </span>
                        {!visuallyCollapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                ))}
            </nav>

            <div className="mt-auto border-t border-border px-2 pb-2 pt-2">
                {userProfile && !visuallyCollapsed && (
                    <div className="mb-2 rounded-xl bg-muted/70 px-2 py-2 text-xs text-muted-foreground">
                        <div className="truncate font-medium text-foreground">
                            {userProfile.full_name || userProfile.email}
                        </div>
                        <div>{getRoleLabel(userProfile.role)}</div>
                    </div>
                )}
                {onSignOut && (
                    <Button
                        type="button"
                        variant="ghost"
                        className={cn(
                            'h-10 w-full justify-start gap-3 text-danger hover:bg-danger-soft hover:text-danger',
                            visuallyCollapsed && 'justify-center px-2',
                        )}
                        onClick={onSignOut}
                        title="로그아웃"
                    >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                            <LogOut size={20} />
                        </span>
                        {!visuallyCollapsed && <span className="truncate">로그아웃</span>}
                    </Button>
                )}
            </div>
        </aside>
    );
}
