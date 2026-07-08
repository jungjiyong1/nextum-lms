import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    Calculator,
    ChevronDown,
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

type NavChild = {
    id: string;
    label: string;
    href: string;
    exact?: boolean;
};

type NavItem = {
    id: AppPage;
    label: string;
    href: string;
    icon: React.ComponentType<{ size?: number }>;
    children?: NavChild[];
};

const navItems: NavItem[] = [
    { id: 'home', label: '홈', href: appPageHref.home, icon: Home },
    {
        id: 'assignments',
        label: '과제',
        href: appPageHref.assignments,
        icon: ClipboardList,
        children: [
            { id: 'assignments-status', label: '과제 현황', href: appPageHref.assignments, exact: true },
            { id: 'assignments-new', label: '과제 관리', href: '/assignments/new', exact: true },
        ],
    },
    {
        id: 'classrooms',
        label: '반/시간표',
        href: appPageHref.classrooms,
        icon: LayoutGrid,
        children: [{ id: 'classrooms-overview', label: '반 운영', href: appPageHref.classrooms }],
    },
    {
        id: 'instructors',
        label: '강사',
        href: appPageHref.instructors,
        icon: Users,
        children: [{ id: 'instructors-overview', label: '강사 현황', href: appPageHref.instructors }],
    },
    {
        id: 'students',
        label: '학생',
        href: appPageHref.students,
        icon: GraduationCap,
        children: [{ id: 'students-overview', label: '학생 현황', href: appPageHref.students }],
    },
    {
        id: 'accounting',
        label: '회계',
        href: appPageHref.accounting,
        icon: Calculator,
        children: [{ id: 'accounting-overview', label: '청구/입금', href: appPageHref.accounting }],
    },
    {
        id: 'settings',
        label: '설정',
        href: appPageHref.settings,
        icon: Settings,
        children: [{ id: 'settings-overview', label: '운영 설정', href: appPageHref.settings }],
    },
];

export function Sidebar({ activePage, onNavigate, onSignOut, userProfile, academyName }: SidebarProps) {
    const pathname = usePathname();
    const [collapsed, setCollapsed] = React.useState(false);
    const [compactViewport, setCompactViewport] = React.useState(false);
    const [expandedSections, setExpandedSections] = React.useState<Set<string>>(new Set([activePage]));
    const visibleNavItems = navItems.filter((item) => canAccessAppPage(userProfile?.role, item.id));
    const visuallyCollapsed = collapsed || compactViewport;

    React.useEffect(() => {
        setExpandedSections(new Set([activePage]));
    }, [activePage]);

    React.useEffect(() => {
        const updateCompactViewport = () => {
            setCompactViewport(window.innerWidth < 768);
        };

        updateCompactViewport();
        window.addEventListener('resize', updateCompactViewport);
        return () => window.removeEventListener('resize', updateCompactViewport);
    }, []);

    const isChildActive = React.useCallback((child: NavChild) => {
        if (child.exact) return pathname === child.href;
        return pathname === child.href || pathname.startsWith(`${child.href}/`);
    }, [pathname]);

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
                {visibleNavItems.map((item) => {
                    const hasChildren = Boolean(item.children?.length);
                    const expanded = !visuallyCollapsed && hasChildren && expandedSections.has(item.id);
                    const active = activePage === item.id;

                    return (
                        <div key={item.id}>
                            <Link
                                href={item.href}
                                className={cn(
                                    'flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-primary-soft/50 hover:text-foreground',
                                    active && 'bg-primary-soft text-primary-strong',
                                    visuallyCollapsed && 'justify-center px-2',
                                )}
                                onClick={() => {
                                    setExpandedSections((prev) => {
                                        if (!hasChildren) return new Set();
                                        if (active && prev.has(item.id)) return new Set();
                                        return new Set([item.id]);
                                    });
                                    onNavigate(item.id);
                                }}
                                title={visuallyCollapsed ? item.label : undefined}
                                aria-expanded={hasChildren ? expanded : undefined}
                            >
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                                    <item.icon size={20} />
                                </span>
                                {!visuallyCollapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                                {!visuallyCollapsed && hasChildren && (
                                    <ChevronDown
                                        size={15}
                                        className={cn(
                                            'shrink-0 transition-transform',
                                            expanded && 'rotate-180',
                                        )}
                                        aria-hidden="true"
                                    />
                                )}
                            </Link>
                            {expanded && (
                                <div className="ml-6 mt-1 space-y-1 border-l border-border pl-2">
                                    {item.children?.map((child) => {
                                        const childActive = isChildActive(child);
                                        return (
                                            <Link
                                                key={child.id}
                                                href={child.href}
                                                className={cn(
                                                    'flex min-h-8 items-center rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground no-underline transition-colors hover:bg-muted hover:text-foreground',
                                                    childActive && 'bg-muted text-foreground',
                                                )}
                                            >
                                                <span className="truncate">{child.label}</span>
                                            </Link>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
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
