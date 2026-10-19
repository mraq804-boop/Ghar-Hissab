create or replace function public.try_uuid(v text) returns uuid
language plpgsql immutable as $$
begin
  return v::uuid;
exception when others then
  return null;
end $$;

create or replace function public.is_member(h uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_roles r
    where r.household_id = h and r.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_admin(h uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_roles r
    where r.household_id = h and r.user_id = (select auth.uid()) and r.role = 'admin'
  );
$$;

create or replace function public.my_unit(h uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.unit_id from public.members m
  where m.household_id = h and m.user_id = (select auth.uid()) and m.active
  limit 1;
$$;

create or replace function public.setting_enabled(h uuid, name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((to_jsonb(s) ->> name)::boolean, false)
  from public.app_settings s where s.household_id = h;
$$;

create or replace function public.purse_holder(h uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.units where household_id = h and is_purse_holder limit 1;
$$;

-- version + updated_at
create or replace function public.tg_bump_version() returns trigger
language plpgsql as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

create trigger expenses_bump before update on public.expenses
  for each row execute function public.tg_bump_version();
create trigger payments_bump before update on public.payments
  for each row execute function public.tg_bump_version();

create or replace function public.tg_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger members_touch before update on public.members for each row execute function public.tg_touch();
create trigger meal_slots_touch before update on public.meal_slots for each row execute function public.tg_touch();
create trigger duty_days_touch before update on public.duty_days for each row execute function public.tg_touch();
create trigger app_settings_touch before update on public.app_settings for each row execute function public.tg_touch();

-- closed periods are read-only for expenses
create or replace function public.tg_guard_closed_period() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  pid uuid := coalesce(new.period_id, old.period_id);
begin
  if exists (select 1 from public.periods p where p.id in (pid, old.period_id) and p.status = 'closed') then
    raise exception 'period_closed' using hint = 'Reopen the month before changing its expenses.';
  end if;
  return coalesce(new, old);
end $$;

create trigger expenses_guard_closed before insert or update or delete on public.expenses
  for each row execute function public.tg_guard_closed_period();

-- audit trail
create or replace function public.tg_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  b jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  a jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  rec jsonb := coalesce(a, b);
begin
  if tg_op = 'UPDATE' and b = a then
    return new;
  end if;
  insert into public.audit_log (household_id, actor_id, table_name, record_id, action, before, after)
  values (
    public.try_uuid(rec ->> 'household_id'),
    (select auth.uid()),
    tg_table_name,
    coalesce(rec ->> 'id', rec ->> 'rule_id', rec ->> 'day', rec ->> 'household_id'),
    lower(tg_op),
    b - 'refresh_token_enc',
    a - 'refresh_token_enc'
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'units', 'members', 'household_roles', 'periods', 'split_rules', 'split_rule_parts',
    'expense_categories', 'expenses', 'payments', 'payment_reviews', 'payment_attachments',
    'meal_slots', 'duty_days', 'app_settings', 'excel_connection'
  ] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.tg_audit()', t || '_audit', t);
  end loop;
end $$;

-- sync outbox
create or replace function public.enqueue_sync(h uuid, s text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.sync_jobs (household_id, scope) values (h, s)
  on conflict (household_id, scope) where status = 'pending' do update set next_attempt_at = least(public.sync_jobs.next_attempt_at, now());
  insert into public.sync_scope_state (household_id, scope, last_change_at) values (h, s, now())
  on conflict (household_id, scope) do update set last_change_at = now();
end $$;

create or replace function public.tg_enqueue_expense() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    perform public.enqueue_sync(old.household_id, 'period:' || old.period_id);
  end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.period_id <> old.period_id) then
    perform public.enqueue_sync(new.household_id, 'period:' || new.period_id);
  end if;
  return coalesce(new, old);
end $$;

create trigger expenses_enqueue after insert or update or delete on public.expenses
  for each row execute function public.tg_enqueue_expense();

create or replace function public.tg_enqueue_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.status = 'approved')
     or (tg_op = 'UPDATE' and (old.status = 'approved' or new.status = 'approved')
         and (old.status, old.amount, old.payer_unit_id, old.period_id) is distinct from (new.status, new.amount, new.payer_unit_id, new.period_id))
     or (tg_op = 'DELETE' and old.status = 'approved') then
    perform public.enqueue_sync(coalesce(new.household_id, old.household_id), 'period:' || coalesce(new.period_id, old.period_id));
    if tg_op = 'UPDATE' and old.period_id <> new.period_id then
      perform public.enqueue_sync(old.household_id, 'period:' || old.period_id);
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger payments_enqueue after insert or update or delete on public.payments
  for each row execute function public.tg_enqueue_payment();

create or replace function public.tg_enqueue_period() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.enqueue_sync(new.household_id, 'period:' || new.id);
  return new;
end $$;

create trigger periods_enqueue after insert on public.periods
  for each row execute function public.tg_enqueue_period();

create or replace function public.tg_enqueue_menu() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.enqueue_sync(coalesce(new.household_id, old.household_id), 'menu');
  return coalesce(new, old);
end $$;

create trigger meal_slots_enqueue after insert or update or delete on public.meal_slots
  for each row execute function public.tg_enqueue_menu();
create trigger sabzi_options_enqueue after insert or update or delete on public.sabzi_options
  for each row execute function public.tg_enqueue_menu();

create or replace function public.tg_enqueue_duties() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d date := coalesce(new.day, old.day);
begin
  perform public.enqueue_sync(coalesce(new.household_id, old.household_id), 'duties:' || to_char(d, 'YYYY-MM'));
  if tg_op = 'UPDATE' and to_char(old.day, 'YYYY-MM') <> to_char(new.day, 'YYYY-MM') then
    perform public.enqueue_sync(old.household_id, 'duties:' || to_char(old.day, 'YYYY-MM'));
  end if;
  return coalesce(new, old);
end $$;

create trigger duty_days_enqueue after insert or update or delete on public.duty_days
  for each row execute function public.tg_enqueue_duties();

create or replace function public.tg_enqueue_member_rename() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m text;
begin
  if (old.full_name, old.duty_label) is distinct from (new.full_name, new.duty_label) then
    for m in
      select distinct to_char(day, 'YYYY-MM') from public.duty_days
      where household_id = new.household_id
        and new.id in (breakfast_member_id, lunch_member_id, dinner_member_id, off_member_id)
    loop
      perform public.enqueue_sync(new.household_id, 'duties:' || m);
    end loop;
  end if;
  return new;
end $$;

create trigger members_enqueue after update on public.members
  for each row execute function public.tg_enqueue_member_rename();

-- rules used by a closed month cannot be changed
create or replace function public.tg_guard_rule_parts() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rid uuid := coalesce(new.rule_id, old.rule_id);
  rec record;
begin
  if exists (
    select 1 from public.expenses e join public.periods p on p.id = e.period_id
    where e.split_rule_id = rid and e.deleted_at is null and p.status = 'closed'
  ) then
    raise exception 'rule_in_closed_period' using hint = 'This rule is used by a closed month. Create a new rule instead.';
  end if;
  for rec in
    select distinct e.household_id, e.period_id from public.expenses e
    where e.split_rule_id = rid and e.deleted_at is null
  loop
    perform public.enqueue_sync(rec.household_id, 'period:' || rec.period_id);
  end loop;
  return coalesce(new, old);
end $$;

create trigger split_rule_parts_guard before insert or update or delete on public.split_rule_parts
  for each row execute function public.tg_guard_rule_parts();

-- link invited users on first sign-in
create or replace function public.tg_link_invited_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inv record;
begin
  for inv in
    select * from public.household_invites
    where lower(email) = lower(new.email) and accepted_at is null
  loop
    update public.members set user_id = new.id where id = inv.member_id and user_id is null;
    insert into public.household_roles (household_id, user_id, role)
    values (inv.household_id, new.id, inv.role)
    on conflict (household_id, user_id) do nothing;
    update public.household_invites set accepted_at = now() where id = inv.id;
  end loop;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.tg_link_invited_user();
