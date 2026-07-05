import { supabase } from '../supabaseClient';
import { loadAuthProfile } from './identity';

export async function requireCurrentAcademyId(): Promise<string> {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
        throw new Error('로그인이 필요합니다.');
    }

    const profile = await loadAuthProfile(data.user);
    const academyId = profile?.current_academy_id;
    if (academyId === null || academyId === undefined || academyId === '') {
        throw new Error('현재 학원 정보를 찾을 수 없습니다.');
    }

    return String(academyId);
}
