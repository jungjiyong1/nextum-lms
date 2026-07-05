import { createHash } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';

type Row = Record<string, any>;

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status });
}

function normalizeLoginId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const loginId = value.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(loginId)) return null;
  return loginId;
}

function normalizeInviteCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return code.length >= 8 ? code : null;
}

function hashInviteCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function loginEmail(loginId: string): string {
  const domain = process.env.LMS_LOGIN_EMAIL_DOMAIN
    || process.env.NEXT_PUBLIC_LMS_LOGIN_EMAIL_DOMAIN
    || 'nextum.local';
  return `${loginId}@${domain}`;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    inviteCode?: unknown;
    loginId?: unknown;
    password?: unknown;
  } | null;

  const inviteCode = normalizeInviteCode(body?.inviteCode);
  const loginId = normalizeLoginId(body?.loginId);
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!inviteCode || !loginId || password.length < 4) {
    return json(400, {
      success: false,
      error: '초대코드, 아이디, 비밀번호를 확인하세요.',
    });
  }

  const admin = createAdminClient();
  const core = admin.schema('core');
  const now = new Date().toISOString();

  const { data: invite, error: inviteError } = await core
    .from('account_invitations')
    .select('id,academy_id,person_id,student_id,role,expires_at,accepted_at')
    .eq('invite_code_hash', hashInviteCode(inviteCode))
    .maybeSingle();

  if (inviteError) throw inviteError;
  const inviteRow = invite as Row | null;
  if (!inviteRow || inviteRow.role !== 'student' || !inviteRow.person_id || !inviteRow.student_id) {
    return json(404, { success: false, error: '유효하지 않은 초대코드입니다.' });
  }
  if (inviteRow.accepted_at) {
    return json(409, { success: false, error: '이미 사용된 초대코드입니다.' });
  }
  if (String(inviteRow.expires_at) <= now) {
    return json(410, { success: false, error: '만료된 초대코드입니다.' });
  }

  const { data: student, error: studentError } = await core
    .from('students')
    .select('id,academy_id,person_id,status')
    .eq('id', inviteRow.student_id)
    .eq('academy_id', inviteRow.academy_id)
    .eq('person_id', inviteRow.person_id)
    .maybeSingle();
  if (studentError) throw studentError;
  if (!student || student.status !== 'active') {
    return json(409, { success: false, error: '활성 학생 정보가 아닙니다.' });
  }

  const [{ data: existingLogin, error: loginError }, { data: existingPersonAccount, error: personAccountError }] = await Promise.all([
    core.from('user_accounts').select('id').ilike('login_id', loginId).limit(1).maybeSingle(),
    core.from('user_accounts').select('id').eq('person_id', inviteRow.person_id).limit(1).maybeSingle(),
  ]);
  if (loginError) throw loginError;
  if (personAccountError) throw personAccountError;
  if (existingLogin) return json(409, { success: false, error: '이미 사용 중인 아이디입니다.' });
  if (existingPersonAccount) return json(409, { success: false, error: '이미 가입된 학생입니다.' });

  const email = loginEmail(loginId);
  const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { login_id: loginId },
  });

  if (createUserError || !createdUser.user) {
    return json(409, { success: false, error: '계정을 생성하지 못했습니다. 아이디를 바꿔 다시 시도하세요.' });
  }

  const authUser = createdUser.user;
  try {
    const { data: account, error: accountError } = await core
      .from('user_accounts')
      .insert({
        auth_user_id: authUser.id,
        person_id: inviteRow.person_id,
        auth_email: email,
        login_id: loginId,
        status: 'active',
        metadata: { invitation_id: inviteRow.id },
      })
      .select('id')
      .single();
    if (accountError) throw accountError;

    const { error: memberError } = await core.from('academy_members').upsert({
      academy_id: inviteRow.academy_id,
      person_id: inviteRow.person_id,
      user_account_id: account.id,
      role: 'student',
      active: true,
    }, { onConflict: 'academy_id,person_id,role' });
    if (memberError) throw memberError;

    const { error: inviteUpdateError } = await core
      .from('account_invitations')
      .update({
        accepted_at: now,
        accepted_auth_user_id: authUser.id,
      })
      .eq('id', inviteRow.id);
    if (inviteUpdateError) throw inviteUpdateError;
  } catch (error) {
    await admin.auth.admin.deleteUser(authUser.id).catch(() => undefined);
    console.error('[Invitation Accept] Failed after auth user creation:', error);
    return json(500, { success: false, error: '가입 처리 중 오류가 발생했습니다.' });
  }

  return json(200, { success: true, loginId });
}
