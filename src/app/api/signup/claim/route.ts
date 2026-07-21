import { createHmac, timingSafeEqual } from 'node:crypto';

import { assertSameOrigin, LmsAuthError } from '@/lib/lms/auth';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const STAFF_ROLES = ['admin', 'staff', 'teacher', 'instructor'] as const;
type StaffInvitationRole = typeof STAFF_ROLES[number];
type Row = Record<string, unknown>;

class SignupError extends Error {
    constructor(
        public readonly status: 400 | 409,
        public readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = 'SignupError';
    }
}

function loginDomain(): string {
    return process.env.NEXT_PUBLIC_LMS_LOGIN_EMAIL_DOMAIN
        || process.env.LMS_LOGIN_EMAIL_DOMAIN
        || 'nextum.local';
}

function inviteSecret(): string {
    const secret = process.env.NEXTUM_INVITE_CODE_SECRET
        || process.env.INVITE_CODE_SECRET
        || process.env.SUPABASE_SECRET_KEY
        || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) throw new Error('Invite code secret is not configured.');
    return secret;
}

function hashInviteCode(code: string): string {
    return createHmac('sha256', inviteSecret()).update(code.trim().toUpperCase()).digest('hex');
}

function safeEqual(leftValue: string, rightValue: string): boolean {
    const left = Buffer.from(leftValue);
    const right = Buffer.from(rightValue);
    return left.length === right.length && timingSafeEqual(left, right);
}

function isStaffRole(value: unknown): value is StaffInvitationRole {
    return typeof value === 'string' && STAFF_ROLES.includes(value as StaffInvitationRole);
}

function publicError(error: unknown): Response {
    if (error instanceof LmsAuthError) {
        return Response.json({ error: { code: 'SIGNUP_FORBIDDEN', message: '회원가입 요청을 확인할 수 없습니다.' } }, {
            status: error.status,
            headers: { 'Cache-Control': 'no-store' },
        });
    }
    if (error instanceof SignupError) {
        return Response.json({ error: { code: error.code, message: error.message } }, {
            status: error.status,
            headers: { 'Cache-Control': 'no-store' },
        });
    }
    console.error('[LMS Signup] Failed:', error);
    return Response.json({
        error: { code: 'SIGNUP_FAILED', message: '회원가입 처리 중 오류가 발생했습니다.' },
    }, {
        status: 500,
        headers: { 'Cache-Control': 'no-store' },
    });
}

export async function POST(request: Request) {
    let createdAuthUserId: string | null = null;
    let claimedInviteId: string | null = null;
    const admin = createAdminClient();
    const core = admin.schema('core');

    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        const body = await request.json().catch(() => null) as {
            inviteCode?: unknown;
            loginId?: unknown;
            password?: unknown;
        } | null;
        const inviteCode = typeof body?.inviteCode === 'string' ? body.inviteCode.trim() : '';
        const loginId = typeof body?.loginId === 'string' ? body.loginId.trim().toLowerCase() : '';
        const password = typeof body?.password === 'string' ? body.password : '';

        if (!inviteCode || !loginId || password.length < 8) {
            throw new SignupError(400, 'INVALID_INPUT', '가입 코드, 아이디, 8자 이상의 비밀번호를 확인하세요.');
        }
        if (!/^[a-z0-9._-]{3,64}$/.test(loginId)) {
            throw new SignupError(400, 'INVALID_LOGIN_ID', '아이디 형식을 확인하세요.');
        }

        const inviteCodeHash = hashInviteCode(inviteCode);
        const { data: rawInvite, error: inviteError } = await core
            .from('account_invitations')
            .select('id,academy_id,person_id,staff_member_id,role,invite_code_hash,expires_at,accepted_at')
            .eq('invite_code_hash', inviteCodeHash)
            .maybeSingle();
        if (inviteError) throw inviteError;
        const invite = rawInvite as Row | null;
        if (!invite || !safeEqual(String(invite.invite_code_hash || ''), inviteCodeHash) || !isStaffRole(invite.role)) {
            throw new SignupError(400, 'INVALID_INVITE_CODE', '가입 코드가 올바르지 않습니다.');
        }
        if (invite.accepted_at) {
            throw new SignupError(409, 'INVITE_ALREADY_USED', '이미 사용된 가입 코드입니다.');
        }
        if (new Date(String(invite.expires_at)).getTime() <= Date.now()) {
            throw new SignupError(400, 'INVITE_EXPIRED', '만료된 가입 코드입니다.');
        }

        const personId = typeof invite.person_id === 'string' ? invite.person_id : '';
        const staffId = typeof invite.staff_member_id === 'string' ? invite.staff_member_id : '';
        const academyId = typeof invite.academy_id === 'string' ? invite.academy_id : '';
        if (!personId || !staffId || !academyId) {
            throw new SignupError(400, 'INVALID_INVITE_CODE', '가입 코드가 올바르지 않습니다.');
        }

        const { data: staff, error: staffError } = await core
            .from('staff_members')
            .select('id,person_id,role,status')
            .eq('id', staffId)
            .eq('academy_id', academyId)
            .eq('person_id', personId)
            .eq('role', invite.role)
            .maybeSingle();
        if (staffError) throw staffError;
        if (!staff?.id || staff.status !== 'active') {
            throw new SignupError(400, 'INVALID_INVITE_CODE', '가입 코드가 올바르지 않습니다.');
        }

        const { data: existingAccounts, error: existingAccountError } = await core
            .from('user_accounts')
            .select('id')
            .ilike('login_id', loginId)
            .limit(1);
        if (existingAccountError) throw existingAccountError;
        if ((existingAccounts || []).length > 0) {
            throw new SignupError(409, 'LOGIN_ID_TAKEN', '이미 사용 중인 아이디입니다.');
        }

        const { data: existingMembers, error: existingMemberError } = await core
            .from('academy_members')
            .select('id,user_account_id')
            .eq('academy_id', academyId)
            .eq('person_id', personId)
            .eq('role', invite.role)
            .eq('active', true)
            .not('user_account_id', 'is', null)
            .limit(1);
        if (existingMemberError) throw existingMemberError;
        if ((existingMembers || []).length > 0) {
            throw new SignupError(409, 'ACCOUNT_ALREADY_EXISTS', '이미 로그인 계정이 연결된 사용자입니다.');
        }

        const acceptedAt = new Date().toISOString();
        const { data: claimedInvite, error: claimError } = await core
            .from('account_invitations')
            .update({ accepted_at: acceptedAt })
            .eq('id', invite.id)
            .is('accepted_at', null)
            .gt('expires_at', acceptedAt)
            .select('id')
            .maybeSingle();
        if (claimError) throw claimError;
        if (!claimedInvite?.id) {
            throw new SignupError(409, 'INVITE_ALREADY_USED', '이미 사용되었거나 만료된 가입 코드입니다.');
        }
        claimedInviteId = String(invite.id);

        const authEmail = `${loginId}@${loginDomain()}`;
        const { data: authData, error: authError } = await admin.auth.admin.createUser({
            email: authEmail,
            password,
            email_confirm: true,
            user_metadata: { login_id: loginId },
        });
        if (authError || !authData.user) throw authError || new Error('Auth user was not created.');
        createdAuthUserId = authData.user.id;

        const { data: account, error: accountError } = await core
            .from('user_accounts')
            .insert({
                auth_user_id: createdAuthUserId,
                person_id: personId,
                auth_email: authEmail,
                login_id: loginId,
                status: 'active',
                metadata: { invitation_id: invite.id },
            })
            .select('id')
            .single();
        if (accountError) throw accountError;

        const { error: memberError } = await core
            .from('academy_members')
            .upsert({
                academy_id: academyId,
                person_id: personId,
                user_account_id: account.id,
                role: invite.role,
                active: true,
            }, { onConflict: 'academy_id,person_id,role' });
        if (memberError) throw memberError;

        const { data: acceptedInvite, error: acceptError } = await core
            .from('account_invitations')
            .update({
                accepted_auth_user_id: createdAuthUserId,
                invite_code_display: null,
            })
            .eq('id', invite.id)
            .eq('accepted_at', acceptedAt)
            .is('accepted_auth_user_id', null)
            .select('id')
            .maybeSingle();
        if (acceptError) throw acceptError;
        if (!acceptedInvite?.id) throw new Error('Invitation acceptance was not finalized.');
        claimedInviteId = null;

        return Response.json({ email: authEmail }, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        let invitationCanBeReleased = !createdAuthUserId;
        if (createdAuthUserId) {
            const { error: deleteError } = await admin.auth.admin.deleteUser(createdAuthUserId);
            if (deleteError) {
                console.error('[LMS Signup] Auth rollback failed:', deleteError);
            } else {
                invitationCanBeReleased = true;
            }
        }
        if (claimedInviteId && invitationCanBeReleased) {
            const { error: releaseError } = await core
                .from('account_invitations')
                .update({ accepted_at: null, accepted_auth_user_id: null })
                .eq('id', claimedInviteId)
                .is('accepted_auth_user_id', null);
            if (releaseError) console.error('[LMS Signup] Invitation rollback failed:', releaseError);
        }
        return publicError(error);
    }
}
