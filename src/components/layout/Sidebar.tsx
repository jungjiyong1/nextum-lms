import React from 'react';
import Link from 'next/link';
import {
    Calculator,
    GraduationCap,
    Home,
    LayoutGrid,
    LogOut,
    Settings,
    Users,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Profile } from '../../contexts/AuthContext';

interface SidebarProps {
    activePage: string;
    onNavigate: (page: string) => void;
    onSignOut?: () => void;
    userProfile?: Profile | null;
    academyName?: string | null;
}

const navItems = [
    { id: 'home', label: '홈', href: '/', icon: Home },
    { id: 'classrooms', label: '반/시간표', href: '/classrooms', icon: LayoutGrid },
    { id: 'instructors', label: '강사', href: '/instructors', icon: Users },
    { id: 'students', label: '학생', href: '/students', icon: GraduationCap },
    { id: 'accounting', label: '회계', href: '/accounting', icon: Calculator },
    { id: 'settings', label: '설정', href: '/settings', icon: Settings },
];

function getRoleLabel(role: string) {
    switch (role) {
        case 'admin':
            return '관리자';
        case 'instructor':
            return '강사';
        case 'staff':
            return '직원';
        default:
            return role;
    }
}

export function Sidebar({ activePage, onNavigate, onSignOut, userProfile, academyName }: SidebarProps) {
    const [collapsed, setCollapsed] = React.useState(false);

    return (
        <aside className={cn('sidebar flex flex-col', collapsed && 'collapsed')}>
            <button
                className="sidebar-header w-full"
                onClick={() => setCollapsed(!collapsed)}
                title={collapsed ? '메뉴 열기' : '메뉴 닫기'}
            >
                <div className="sidebar-logo">
                    <img src="/icon.png" alt="NEXTUM LMS" className="w-8 h-8 rounded-lg" />
                </div>
                {!collapsed && <span className="sidebar-title">{academyName || 'NEXTUM LMS'}</span>}
            </button>

            <nav className="sidebar-nav flex-1">
                {navItems.map((item) => (
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

            <div className="mt-auto border-t border-white/10 pt-2 pb-2 px-2">
                {userProfile && !collapsed && (
                    <div className="px-2 py-2 mb-2 text-xs text-white/60">
                        <div className="font-medium text-white/80 truncate">
                            {userProfile.full_name || userProfile.email}
                        </div>
                        <div className="text-white/40">
                            {getRoleLabel(userProfile.role)}
                        </div>
                    </div>
                )}
                {onSignOut && (
                    <button
                        className={cn(
                            'nav-item w-full text-red-400 hover:text-red-300 hover:bg-red-500/10',
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
