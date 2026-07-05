'use client';

import { useRouter } from 'next/navigation';
import { HomeDashboard } from '@/components/home/HomeDashboard';
import { RouteScroll } from './RouteScroll';

const hrefByPage: Record<string, string> = {
    home: '/',
    classrooms: '/classrooms',
    instructors: '/instructors',
    students: '/students',
    accounting: '/accounting',
    settings: '/settings',
};

export function HomeRoute() {
    const router = useRouter();

    return (
        <RouteScroll>
            <HomeDashboard onNavigate={(page) => router.push(hrefByPage[page] ?? '/')} />
        </RouteScroll>
    );
}
