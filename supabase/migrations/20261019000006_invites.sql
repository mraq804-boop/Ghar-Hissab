create or replace function public.link_existing_user(invite_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
  inv record;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  select id into uid from auth.users where lower(email) = lower(invite_email) limit 1;
  if uid is null then
    return null;
  end if;
  for inv in select * from public.household_invites where lower(email) = lower(invite_email) and accepted_at is null loop
    update public.members set user_id = uid where id = inv.member_id and user_id is null;
    insert into public.household_roles (household_id, user_id, role) values (inv.household_id, uid, inv.role)
    on conflict (household_id, user_id) do update set role = excluded.role;
    update public.household_invites set accepted_at = now() where id = inv.id;
  end loop;
  return uid;
end $$;

revoke execute on function public.link_existing_user(text) from public, anon, authenticated;

create or replace function public.set_member_role(member uuid, new_role public.app_role) returns void
language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  select * into m from public.members where id = member;
  if m.id is null or not public.is_admin(m.household_id) then
    raise exception 'forbidden';
  end if;
  if m.user_id is null then
    raise exception 'invalid_expense' using hint = 'Invite this member before changing their role.';
  end if;
  if m.user_id = auth.uid() then
    raise exception 'forbidden' using hint = 'You cannot change your own role.';
  end if;
  update public.household_roles set role = new_role where household_id = m.household_id and user_id = m.user_id;
end $$;

create or replace function public.set_member_active(member uuid, is_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  select * into m from public.members where id = member;
  if m.id is null or not public.is_admin(m.household_id) then
    raise exception 'forbidden';
  end if;
  if m.user_id = auth.uid() and not is_active then
    raise exception 'forbidden' using hint = 'You cannot deactivate yourself.';
  end if;
  update public.members set active = is_active where id = member;
  if not is_active and m.user_id is not null then
    delete from public.household_roles where household_id = m.household_id and user_id = m.user_id;
  elsif is_active and m.user_id is not null then
    insert into public.household_roles (household_id, user_id, role) values (m.household_id, m.user_id, 'member')
    on conflict do nothing;
  end if;
end $$;
