-- A staff member can have only one outstanding one-time signup code. The
-- application deletes the previous pending row before issuing a replacement;
-- this index also closes the concurrent reissue race at the database boundary.
create unique index if not exists core_account_invitations_staff_pending_key
  on core.account_invitations (academy_id, staff_member_id)
  where staff_member_id is not null
    and accepted_at is null;

create index if not exists core_account_invitations_staff_lookup_idx
  on core.account_invitations (academy_id, staff_member_id, role, expires_at, created_at desc)
  where staff_member_id is not null;

comment on index core.core_account_invitations_staff_pending_key is
  'Ensures a staff member has at most one unclaimed LMS signup invitation.';
