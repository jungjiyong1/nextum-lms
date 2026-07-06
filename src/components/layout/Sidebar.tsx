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
    const visibleNavItems = navItems.filter((item) => canAccessAppPage(userProfile?.role, item.id));

    return (
        <aside className={cn('sidebar flex flex-col', collapsed && 'collapsed')}>
            <button
                type="button"
                className="sidebar-header w-full"
                onClick={() => setCollapsed(!collapsed)}
                title={collapsed ? '메뉴 열기' : '메뉴 닫기'}
            >
                <div className="sidebar-logo">
                    <img src="/icon.png" alt="NEXTUM LMS" className="h-8 w-8 rounded-lg" />
                </div>
                {!collapsed && <span className="sidebar-title">{academyName || 'NEXTUM LMS'}</span>}
            </button>

            <nav className="sidebar-nav flex-1">
                {visibleNavItems.map((item) => (
                    <Link
                        key={item.id}
                        href={item.href}
                        className={cn('nav-item', activePage === item.id && 'active')}
                        onClick={() => onNavigate(item.id)}
                    >
                        <span className="nav-icon">
                            <item.icon size={20} />
                        </span>
                        {!collapsed && <span className="nav-label">{item.label}</span>}
                    </Link>
                ))}
            </nav>

            <div className="mt-auto border-t border-white/10 px-2 pb-2 pt-2">
                {userProfile && !collapsed && (
                    <div className="mb-2 px-2 py-2 text-xs text-white/60">
                        <div className="truncate font-medium text-white/80">
                            {userProfile.full_name || userProfile.email}
                        </div>
                        <div className="text-white/40">
                            {getRoleLabel(userProfile.role)}
                        </div>
                    </div>
                )}
                {onSignOut && (
                    <button
                        type="button"
                        className={cn(
                            'nav-item w-full text-red-400 hover:bg-red-500/10 hover:text-red-300',
                            collapsed && 'justify-center',
                        )}
                        onClick={onSignOut}
                        title="로그아웃"
                    >
                        <span className="nav-icon">
                            <LogOut size={20} />
                        </span>
                        {!collapsed && <span className="nav-label">로그아웃</span>}
                    </button>
                )}
            </div>
        </aside>
    );
}
