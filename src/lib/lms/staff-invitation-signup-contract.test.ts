import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const staffMutation = source('src/lib/lms/mutations.ts');
const staffRoute = source('src/app/api/lms/staff/route.ts');
const invitationRoute = source('src/app/api/lms/staff/invitations/route.ts');
const signupRoute = source('src/app/api/signup/claim/route.ts');
const signupPage = source('src/app/signup/page.tsx');
const migration = source('supabase/migrations/20260721141617_staff_invitation_signup.sql');

describe('staff invitation signup contract', () => {
    it('issues an invitation as part of staff creation and supports privileged reissue', () => {
        expect(staffMutation).toContain('issueStaffInvitationForAcademy(');
        expect(staffMutation).toContain("randomBytes(8).toString('hex').toUpperCase()");
        expect(staffMutation).toContain('invite_code_hash: hashInviteCode(inviteCode)');
        expect(staffMutation).toContain('staff_member_id: staffId');
        expect(staffRoute).toContain('return mutationSuccess(result, { request })');
        expect(invitationRoute).toContain("['owner', 'admin']");
    });

    it('claims a code once before creating the auth identity and academy membership', () => {
        expect(signupRoute).toContain(".is('accepted_at', null)");
        expect(signupRoute).toContain(".gt('expires_at', acceptedAt)");
        expect(signupRoute).toContain('admin.auth.admin.createUser');
        expect(signupRoute).toContain(".from('user_accounts')");
        expect(signupRoute).toContain(".from('academy_members')");
        expect(signupRoute).toContain('role: invite.role');
        expect(signupRoute).toContain('invite_code_display: null');
    });

    it('rolls back both auth and invitation reservation after a partial failure', () => {
        expect(signupRoute).toContain('admin.auth.admin.deleteUser(createdAuthUserId)');
        expect(signupRoute).toContain(".update({ accepted_at: null, accepted_auth_user_id: null })");
        expect(signupRoute).toContain("console.error('[LMS Signup] Auth rollback failed:'");
        expect(signupRoute).toContain("console.error('[LMS Signup] Invitation rollback failed:'");
    });

    it('requires the one-time code on the public signup screen', () => {
        expect(signupPage).toContain("fetch('/api/signup/claim'");
        expect(signupPage).toContain('inviteCode: inviteCode.trim()');
        expect(signupPage).toContain('signInWithPassword');
        expect(signupPage).toContain('학원에서 받은 일회용 코드');
    });

    it('prevents concurrent pending invitations for one staff member', () => {
        expect(migration).toContain('create unique index if not exists core_account_invitations_staff_pending_key');
        expect(migration).toContain('where staff_member_id is not null');
        expect(migration).toContain('and accepted_at is null');
    });
});
