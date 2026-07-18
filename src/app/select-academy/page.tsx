import { redirect } from 'next/navigation';

import { AcademySelector } from './AcademySelector';
import { loadAcademyAccessContext } from '@/lib/lms/academy-access';
import { LmsAuthError } from '@/lib/lms/auth';

export const dynamic = 'force-dynamic';

export default async function SelectAcademyPage() {
    try {
        const access = await loadAcademyAccessContext();
        return (
            <AcademySelector
                academies={access.academies}
                displayName={access.person?.full_name || access.account.login_id || '관리자'}
                isSuperAdmin={access.isSuperAdmin}
            />
        );
    } catch (error) {
        if (error instanceof LmsAuthError && error.status === 401) {
            redirect('/login');
        }
        throw error;
    }
}
