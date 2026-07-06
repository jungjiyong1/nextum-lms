alter table core.account_invitations
  add column if not exists invite_code_display text;

comment on column core.account_invitations.invite_code_display is
  'Plain one-time invite code shown only to LMS staff while the invitation is unaccepted.';

create index if not exists core_account_invitations_student_pending_idx
  on core.account_invitations (academy_id, student_id, role, accepted_at, expires_at, created_at desc)
  where role = 'student';
