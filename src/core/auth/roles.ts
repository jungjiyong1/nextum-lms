export type AppRole = 'owner' | 'admin' | 'staff' | 'teacher' | 'instructor' | 'student' | 'guardian';

export const appPages = ['home', 'assignments', 'learning', 'classrooms', 'instructors', 'students', 'accounting', 'settings'] as const;
export type AppPage = typeof appPages[number];

export const appPageHref: Record<AppPage, string> = {
    home: '/',
    assignments: '/assignments',
    learning: '/learning',
    classrooms: '/classrooms',
    instructors: '/instructors',
    students: '/students',
    accounting: '/accounting',
    settings: '/settings',
};

const pageAccess: Record<AppPage, readonly AppRole[]> = {
    home: ['owner', 'admin', 'staff', 'teacher', 'instructor'],
    assignments: ['owner', 'admin', 'staff', 'teacher', 'instructor'],
    learning: ['owner', 'admin', 'staff', 'teacher', 'instructor'],
    classrooms: ['owner', 'admin', 'staff', 'teacher', 'instructor'],
    instructors: ['owner', 'admin', 'staff', 'teacher', 'instructor'],
    students: ['owner', 'admin', 'staff', 'teacher', 'instructor'],
    accounting: ['owner', 'admin', 'staff'],
    settings: ['owner', 'admin'],
};

export function normalizeAppRole(value: unknown): AppRole {
    switch (value) {
        case 'owner':
        case 'admin':
        case 'staff':
        case 'teacher':
        case 'instructor':
        case 'student':
        case 'guardian':
            return value;
        case 'manager':
            return 'admin';
        default:
            return 'student';
    }
}

export function getRoleLabel(role: AppRole | string): string {
    switch (role) {
        case 'owner':
            return '소유자';
        case 'admin':
            return '관리자';
        case 'staff':
            return '직원';
        case 'teacher':
        case 'instructor':
            return '강사';
        case 'student':
            return '학생';
        case 'guardian':
            return '보호자';
        default:
            return '권한 없음';
    }
}

export function appPageFromPath(pathname: string): AppPage {
    if (pathname.startsWith('/assignments')) return 'assignments';
    if (pathname.startsWith('/learning')) return 'learning';
    if (pathname.startsWith('/classrooms')) return 'classrooms';
    if (pathname.startsWith('/instructors')) return 'instructors';
    if (pathname.startsWith('/students')) return 'students';
    // 학습지 만들기는 학생 관리와 같은 접근 정책을 쓴다 (별도 메뉴 없음).
    if (pathname.startsWith('/worksheets')) return 'students';
    if (pathname.startsWith('/accounting')) return 'accounting';
    if (pathname.startsWith('/settings')) return 'settings';
    return 'home';
}

export function canAccessAppPage(role: AppRole | null | undefined, page: AppPage): boolean {
    if (!role) return false;
    return pageAccess[page].includes(role);
}

export function canAccessAppPath(role: AppRole | null | undefined, pathname: string): boolean {
    const page = appPageFromPath(pathname);
    if (!canAccessAppPage(role, page)) return false;
    if (pathname === '/accounting/reports' || pathname.startsWith('/accounting/reports/')) {
        return role === 'owner' || role === 'admin';
    }
    return true;
}

export function canManageScheduleRules(role: AppRole | null | undefined): boolean {
    return role === 'owner' || role === 'admin' || role === 'staff';
}

export function canManageGlobalClassResources(role: AppRole | null | undefined): boolean {
    return canManageScheduleRules(role);
}

export function canCreateClass(role: AppRole | null | undefined): boolean {
    return canManageGlobalClassResources(role);
}

export function canOperateAssignedClass(role: AppRole | null | undefined): boolean {
    return canManageGlobalClassResources(role) || role === 'teacher' || role === 'instructor';
}

export function requiresAssignedClassScope(role: AppRole | null | undefined): boolean {
    return role === 'teacher' || role === 'instructor';
}

export function firstAccessibleAppPage(role: AppRole | null | undefined): AppPage | null {
    if (!role) return null;
    return appPages.find((page) => canAccessAppPage(role, page)) ?? null;
}
