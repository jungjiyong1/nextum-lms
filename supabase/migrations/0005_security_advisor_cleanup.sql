-- Cleanup after Supabase Security Advisor.

create or replace function core.set_updated_at()
returns trigger
language plpgsql
set search_path = core, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function lms.set_updated_at()
returns trigger
language plpgsql
set search_path = lms, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop policy if exists academies_member_select on core.academies;
create policy academies_member_select on core.academies
  for select to authenticated
  using (
    exists (
      select 1
      from core.academy_members am
      join core.user_accounts ua on ua.person_id = am.person_id
      where ua.auth_user_id = (select auth.uid())
        and ua.status = 'active'
        and am.academy_id = academies.id
        and am.active
    )
  );

drop policy if exists academies_staff_insert on core.academies;
create policy academies_staff_insert on core.academies
  for insert to authenticated
  with check (false);

notify pgrst, 'reload schema';
