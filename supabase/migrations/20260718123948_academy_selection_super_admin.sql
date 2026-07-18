-- Brand the existing data academy and reuse the empty bootstrap academy as the
-- second operating academy. If the bootstrap row is absent, create the academy.
update core.academies
set name = '플립수학 종암',
    updated_at = now()
where name = '넥섬학원';

do $migration$
begin
  if not exists (
    select 1
    from core.academies
    where name = '팩토플러스 2관학원'
  ) then
    update core.academies
    set name = '팩토플러스 2관학원',
        status = 'active',
        updated_at = now()
    where id = (
      select id
      from core.academies
      where name = 'NEXTUM Academy'
      order by created_at
      limit 1
    );

    if not found then
      insert into core.academies (name, status)
      values ('팩토플러스 2관학원', 'active');
    end if;
  end if;
end
$migration$;

-- This flag is managed in the private application account table and is never
-- accepted from browser-controlled auth user metadata.
update core.user_accounts
set metadata = coalesce(metadata, '{}'::jsonb) || '{"super_admin": true}'::jsonb,
    updated_at = now()
where login_id = 'admin'
  and auth_email = 'admin@nextum.local'
  and status = 'active';

insert into core.academy_members (
  academy_id,
  person_id,
  user_account_id,
  role,
  active
)
select
  academy.id,
  account.person_id,
  account.id,
  'admin',
  true
from core.academies academy
join core.user_accounts account
  on account.login_id = 'admin'
 and account.auth_email = 'admin@nextum.local'
 and account.status = 'active'
where academy.status = 'active'
on conflict (academy_id, person_id, role)
do update
set user_account_id = excluded.user_account_id,
    active = true,
    updated_at = now();

-- Newly created academies automatically receive every active super admin.
create or replace function core.add_super_admin_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into core.academy_members (
    academy_id,
    person_id,
    user_account_id,
    role,
    active
  )
  select
    new.id,
    account.person_id,
    account.id,
    'admin',
    true
  from core.user_accounts account
  where account.status = 'active'
    and account.metadata @> '{"super_admin": true}'::jsonb
  on conflict (academy_id, person_id, role)
  do update
  set user_account_id = excluded.user_account_id,
      active = true,
      updated_at = now();

  return new;
end
$function$;

revoke all on function core.add_super_admin_memberships() from public, anon, authenticated;

drop trigger if exists add_super_admin_memberships on core.academies;
create trigger add_super_admin_memberships
after insert on core.academies
for each row
execute function core.add_super_admin_memberships();
