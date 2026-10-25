-- Ghar Hisaab: all migrations in order. Paste into Supabase SQL Editor and Run once on a NEW project.
-- Generated from supabase/migrations; edit those files, not this one.

-- ===== 20261019000001_core_schema.sql =====
create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum ('admin', 'member');
create type public.period_status as enum ('open', 'closed');
create type public.split_type as enum ('equal_units', 'weights', 'percentage', 'custom_amounts', 'none');
create type public.payment_status as enum ('pending', 'approved', 'rejected');
create type public.payment_method as enum ('cash', 'bank_transfer', 'easypaisa', 'jazzcash', 'raast', 'card', 'other');
create type public.record_source as enum ('app', 'import');
create type public.sync_status as enum ('pending', 'running', 'succeeded', 'failed');

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  currency char(3) not null default 'PKR',
  timezone text not null default 'Asia/Karachi',
  created_at timestamptz not null default now()
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  code text not null check (code ~ '^[A-Z0-9]{1,8}$'),
  name text not null,
  sort_order int not null default 0,
  is_purse_holder boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (household_id, code),
  unique (household_id, id)
);
create unique index units_one_purse_holder on public.units (household_id) where is_purse_holder;

create table public.members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  unit_id uuid not null,
  full_name text not null check (length(trim(full_name)) between 1 and 120),
  phone text,
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  relation text,
  duty_label text,
  joined_on date not null default current_date,
  active boolean not null default true,
  user_id uuid unique references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, unit_id) references public.units (household_id, id),
  unique (household_id, id)
);
create index members_unit_idx on public.members (unit_id);
create unique index members_email_unique on public.members (household_id, lower(email)) where email is not null;

create table public.household_roles (
  household_id uuid not null references public.households on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role public.app_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_roles_user_idx on public.household_roles (user_id);

create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  member_id uuid not null references public.members on delete cascade,
  email text not null,
  role public.app_role not null default 'member',
  invited_by uuid references auth.users,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index household_invites_open on public.household_invites (lower(email)) where accepted_at is null;

create table public.periods (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  year int not null check (year between 2020 and 2100),
  month int not null check (month between 1 and 12),
  status public.period_status not null default 'open',
  sheet_name text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (household_id, year, month),
  unique (household_id, id)
);

create table public.expense_sections (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  key text not null check (key ~ '^[A-Z_]{2,32}$'),
  title text not null,
  sort_order int not null default 0,
  unique (household_id, key),
  unique (household_id, id)
);

create table public.split_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name text not null,
  code text not null check (code ~ '^[A-Z0-9_-]{2,24}$'),
  type public.split_type not null,
  description text,
  is_system boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (household_id, name),
  unique (household_id, code),
  unique (household_id, id)
);

create table public.split_rule_parts (
  rule_id uuid not null references public.split_rules on delete cascade,
  unit_id uuid not null references public.units on delete restrict,
  num int check (num >= 0),
  den int check (den > 0),
  percent numeric(5, 2) check (percent between 0 and 100),
  primary key (rule_id, unit_id)
);

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  section_id uuid not null,
  default_split_rule_id uuid,
  icon text,
  sort_order int not null default 0,
  active boolean not null default true,
  foreign key (household_id, section_id) references public.expense_sections (household_id, id),
  foreign key (household_id, default_split_rule_id) references public.split_rules (household_id, id),
  unique (household_id, id)
);
create unique index expense_categories_name on public.expense_categories (household_id, lower(name));

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  period_id uuid not null,
  section_id uuid not null,
  category_id uuid,
  title text not null check (length(trim(title)) between 1 and 120),
  description text,
  qty_text text check (length(qty_text) <= 40),
  qty_num numeric(12, 3) check (qty_num >= 0),
  rate numeric(14, 2) check (rate >= 0),
  amount numeric(14, 2) check (amount >= 0),
  split_rule_id uuid,
  split_override jsonb,
  expense_date date,
  paid_by_unit_id uuid,
  receipt_path text,
  notes text check (length(notes) <= 1000),
  sort_order int not null default 0,
  source public.record_source not null default 'app',
  version int not null default 1,
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (household_id, period_id) references public.periods (household_id, id),
  foreign key (household_id, section_id) references public.expense_sections (household_id, id),
  foreign key (household_id, category_id) references public.expense_categories (household_id, id),
  foreign key (household_id, split_rule_id) references public.split_rules (household_id, id),
  foreign key (household_id, paid_by_unit_id) references public.units (household_id, id),
  constraint expenses_split_choice check ((split_rule_id is null) <> (split_override is null)),
  constraint expenses_rate_math check (rate is null or (qty_num is not null and amount = round(qty_num * rate, 2))),
  unique (household_id, id)
);
create index expenses_period_idx on public.expenses (period_id, section_id, sort_order) where deleted_at is null;
create index expenses_category_idx on public.expenses (category_id) where deleted_at is null;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  period_id uuid not null,
  payer_unit_id uuid not null,
  payer_member_id uuid,
  recipient_unit_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  paid_on date not null,
  method public.payment_method not null,
  reference text check (length(reference) <= 80),
  related_expense_id uuid,
  notes text check (length(notes) <= 1000),
  status public.payment_status not null default 'pending',
  source public.record_source not null default 'app',
  idempotency_key uuid not null unique,
  submitted_by uuid references auth.users,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, period_id) references public.periods (household_id, id),
  foreign key (household_id, payer_unit_id) references public.units (household_id, id),
  foreign key (household_id, recipient_unit_id) references public.units (household_id, id),
  foreign key (household_id, payer_member_id) references public.members (household_id, id),
  foreign key (household_id, related_expense_id) references public.expenses (household_id, id)
);
create unique index payments_reference_unique on public.payments (household_id, method, lower(reference))
  where reference is not null and status <> 'rejected';
create index payments_period_idx on public.payments (period_id, payer_unit_id, status);
create index payments_status_idx on public.payments (household_id, status, created_at desc);

create table public.payment_attachments (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid references auth.users,
  created_at timestamptz not null default now()
);
create index payment_attachments_payment_idx on public.payment_attachments (payment_id);
create index payment_attachments_sha_idx on public.payment_attachments (sha256);

create table public.payment_reviews (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments on delete cascade,
  decision public.payment_status not null check (decision in ('approved', 'rejected')),
  reason text check (length(reason) <= 500),
  reviewer_id uuid references auth.users,
  created_at timestamptz not null default now()
);
create index payment_reviews_payment_idx on public.payment_reviews (payment_id, created_at desc);

create table public.meal_slots (
  household_id uuid not null references public.households on delete cascade,
  week int not null check (week between 1 and 4),
  weekday int not null check (weekday between 1 and 7),
  fixed_category text not null default '',
  dish text not null default '',
  updated_at timestamptz not null default now(),
  primary key (household_id, week, weekday)
);

create table public.sabzi_options (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name text not null,
  sort_order int not null default 0,
  unique (household_id, name)
);

create table public.kitchen_notes (
  household_id uuid not null references public.households on delete cascade,
  scope text not null,
  sort_order int not null,
  body text not null,
  primary key (household_id, scope, sort_order)
);

create table public.duty_days (
  household_id uuid not null references public.households on delete cascade,
  day date not null,
  breakfast_member_id uuid,
  lunch_member_id uuid,
  dinner_member_id uuid,
  off_member_id uuid,
  off_note text,
  updated_at timestamptz not null default now(),
  primary key (household_id, day),
  foreign key (household_id, breakfast_member_id) references public.members (household_id, id),
  foreign key (household_id, lunch_member_id) references public.members (household_id, id),
  foreign key (household_id, dinner_member_id) references public.members (household_id, id),
  foreign key (household_id, off_member_id) references public.members (household_id, id)
);

create table public.app_settings (
  household_id uuid primary key references public.households on delete cascade,
  members_see_all_expenses boolean not null default true,
  members_see_all_balances boolean not null default true,
  members_see_reports boolean not null default true,
  max_upload_mb int not null default 5 check (max_upload_mb between 1 and 10),
  updated_at timestamptz not null default now()
);

create table public.excel_connection (
  household_id uuid primary key references public.households on delete cascade,
  account_email text,
  drive_id text,
  item_id text,
  file_name text,
  web_url text,
  refresh_token_enc text,
  token_updated_at timestamptz,
  connected_by uuid references auth.users,
  connected_at timestamptz not null default now()
);

create table public.excel_sheets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  scope text not null,
  worksheet_id text,
  worksheet_name text not null,
  layout_version int not null default 1,
  force_rebuild boolean not null default false,
  last_synced_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (household_id, scope)
);

create table public.sync_jobs (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households on delete cascade,
  scope text not null,
  status public.sync_status not null default 'pending',
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create unique index sync_jobs_one_pending on public.sync_jobs (household_id, scope) where status = 'pending';
create index sync_jobs_due_idx on public.sync_jobs (status, next_attempt_at);

create table public.sync_scope_state (
  household_id uuid not null references public.households on delete cascade,
  scope text not null,
  last_change_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_success_started_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  primary key (household_id, scope)
);

create table public.sync_runs (
  id bigint generated always as identity primary key,
  job_id bigint references public.sync_jobs on delete set null,
  household_id uuid not null references public.households on delete cascade,
  scope text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  message text,
  details jsonb
);
create index sync_runs_household_idx on public.sync_runs (household_id, started_at desc);

create table public.sync_leases (
  household_id uuid primary key references public.households on delete cascade,
  holder uuid,
  lease_until timestamptz not null default '-infinity'
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  household_id uuid,
  actor_id uuid,
  table_name text not null,
  record_id text,
  action text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_household_idx on public.audit_log (household_id, created_at desc);
create index audit_log_record_idx on public.audit_log (table_name, record_id);

-- ===== 20261019000002_functions_triggers.sql =====
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

-- ===== 20261019000003_rpc.sql =====
-- split validation shared by expenses and rules
create or replace function public.validate_split(h uuid, spec jsonb, amount numeric) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  t text := spec ->> 'type';
  part jsonb;
  ids uuid[] := '{}';
  uid uuid;
  denom_product numeric := 1;
  num_sum numeric := 0;
  pct_sum numeric := 0;
  amt_sum numeric := 0;
begin
  if t is null or t not in ('equal_units', 'weights', 'percentage', 'custom_amounts', 'none') then
    raise exception 'invalid_split' using hint = 'Unknown split type.';
  end if;
  if t = 'none' then
    return;
  end if;

  if t = 'equal_units' then
    select coalesce(array_agg(public.try_uuid(x)), '{}') into ids from jsonb_array_elements_text(spec -> 'unitIds') x;
    if cardinality(ids) = 0 then
      raise exception 'invalid_split' using hint = 'Select at least one unit.';
    end if;
  else
    for part in select * from jsonb_array_elements(spec -> 'parts') loop
      uid := public.try_uuid(part ->> 'unitId');
      ids := ids || uid;
      if t = 'weights' then
        if (part ->> 'num')::int < 0 or (part ->> 'den')::int <= 0 then
          raise exception 'invalid_split' using hint = 'Weights must be positive fractions.';
        end if;
        denom_product := denom_product * (part ->> 'den')::numeric;
      elsif t = 'percentage' then
        pct_sum := pct_sum + (part ->> 'percent')::numeric;
      else
        amt_sum := amt_sum + (part ->> 'amountPaisa')::numeric / 100;
      end if;
    end loop;
    if t = 'weights' then
      for part in select * from jsonb_array_elements(spec -> 'parts') loop
        num_sum := num_sum + (part ->> 'num')::numeric * denom_product / (part ->> 'den')::numeric;
      end loop;
      if num_sum <> denom_product then
        raise exception 'invalid_split' using hint = 'Weights must add up to 1.';
      end if;
    elsif t = 'percentage' and pct_sum <> 100 then
      raise exception 'invalid_split' using hint = 'Percentages must add up to 100.';
    elsif t = 'custom_amounts' and (amount is null or amt_sum <> amount) then
      raise exception 'invalid_split' using hint = 'Custom amounts must add up to the expense amount.';
    end if;
  end if;

  if (select count(distinct x) from unnest(ids) x) <> cardinality(ids) or array_position(ids, null) is not null then
    raise exception 'invalid_split' using hint = 'Each unit can appear once.';
  end if;
  if exists (select 1 from unnest(ids) x where not exists (select 1 from public.units u where u.id = x and u.household_id = h)) then
    raise exception 'invalid_split' using hint = 'Split refers to a unit outside this household.';
  end if;
end $$;

create or replace function public.upsert_expense(p jsonb) returns table (id uuid, version int)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  h uuid := (p ->> 'household_id')::uuid;
  eid uuid := public.try_uuid(p ->> 'id');
  qty numeric := nullif(p ->> 'qty_num', '')::numeric;
  rt numeric := nullif(p ->> 'rate', '')::numeric;
  amt numeric := nullif(p ->> 'amount', '')::numeric;
  rule uuid := public.try_uuid(p ->> 'split_rule_id');
  override jsonb := case when jsonb_typeof(p -> 'split_override') = 'object' then p -> 'split_override' end;
  payer uuid := coalesce(public.try_uuid(p ->> 'paid_by_unit_id'), public.purse_holder(h));
  res record;
begin
  if not public.is_admin(h) then
    raise exception 'forbidden' using hint = 'Only administrators can change expenses.';
  end if;
  if rt is not null then
    if qty is null then
      raise exception 'invalid_expense' using hint = 'Quantity is required when a rate is set.';
    end if;
    amt := round(qty * rt, 2);
  end if;
  if (rule is null) = (override is null) then
    raise exception 'invalid_expense' using hint = 'Choose a split rule or a custom split.';
  end if;
  if override is not null then
    perform public.validate_split(h, override, amt);
  end if;

  if eid is null then
    insert into public.expenses (
      household_id, period_id, section_id, category_id, title, description, qty_text, qty_num, rate, amount,
      split_rule_id, split_override, expense_date, paid_by_unit_id, receipt_path, notes, sort_order,
      created_by, updated_by
    ) values (
      h, (p ->> 'period_id')::uuid, (p ->> 'section_id')::uuid, public.try_uuid(p ->> 'category_id'),
      trim(p ->> 'title'), nullif(p ->> 'description', ''), nullif(p ->> 'qty_text', ''), qty, rt, amt,
      rule, override, nullif(p ->> 'expense_date', '')::date, payer, nullif(p ->> 'receipt_path', ''),
      nullif(p ->> 'notes', ''),
      coalesce((p ->> 'sort_order')::int,
        (select coalesce(max(e.sort_order), 0) + 1 from public.expenses e
         where e.period_id = (p ->> 'period_id')::uuid and e.section_id = (p ->> 'section_id')::uuid)),
      auth.uid(), auth.uid()
    ) returning expenses.id, expenses.version into res;

    if payer is distinct from public.purse_holder(h) and amt is not null and amt > 0 then
      insert into public.payments (
        household_id, period_id, payer_unit_id, recipient_unit_id, amount, paid_on, method, related_expense_id,
        notes, status, idempotency_key, submitted_by
      ) values (
        h, (p ->> 'period_id')::uuid, payer, public.purse_holder(h), amt,
        coalesce(nullif(p ->> 'expense_date', '')::date, current_date), 'other', res.id,
        'Paid directly for: ' || trim(p ->> 'title'), 'pending', gen_random_uuid(), auth.uid()
      );
    end if;
  else
    update public.expenses e set
      period_id = (p ->> 'period_id')::uuid,
      section_id = (p ->> 'section_id')::uuid,
      category_id = public.try_uuid(p ->> 'category_id'),
      title = trim(p ->> 'title'),
      description = nullif(p ->> 'description', ''),
      qty_text = nullif(p ->> 'qty_text', ''),
      qty_num = qty,
      rate = rt,
      amount = amt,
      split_rule_id = rule,
      split_override = override,
      expense_date = nullif(p ->> 'expense_date', '')::date,
      paid_by_unit_id = payer,
      receipt_path = coalesce(nullif(p ->> 'receipt_path', ''), e.receipt_path),
      notes = nullif(p ->> 'notes', ''),
      sort_order = coalesce((p ->> 'sort_order')::int, e.sort_order),
      updated_by = auth.uid()
    where e.id = eid and e.household_id = h and e.deleted_at is null
      and e.version = (p ->> 'expected_version')::int
    returning e.id, e.version into res;
    if not found then
      raise exception 'conflict' using hint = 'This expense was changed by someone else. Reload and try again.';
    end if;
  end if;
  return query select res.id, res.version;
end $$;

create or replace function public.delete_expense(expense_id uuid, expected_version int) returns void
language plpgsql security definer set search_path = '' as $$
declare h uuid;
begin
  select household_id into h from public.expenses where id = expense_id;
  if h is null or not public.is_admin(h) then
    raise exception 'forbidden';
  end if;
  update public.expenses set deleted_at = now(), updated_by = auth.uid()
  where id = expense_id and version = expected_version and deleted_at is null;
  if not found then
    raise exception 'conflict' using hint = 'This expense was changed by someone else. Reload and try again.';
  end if;
end $$;

create or replace function public.submit_payment(p jsonb) returns table (id uuid, status public.payment_status, duplicate_screenshot boolean, replayed boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  h uuid := (p ->> 'household_id')::uuid;
  key uuid := (p ->> 'idempotency_key')::uuid;
  payer uuid := (p ->> 'payer_unit_id')::uuid;
  admin boolean := public.is_admin(h);
  att jsonb := p -> 'attachment';
  existing record;
  pid uuid;
  dup boolean := false;
begin
  if not public.is_member(h) then
    raise exception 'forbidden';
  end if;

  select pm.id, pm.status, pm.submitted_by into existing from public.payments pm where pm.idempotency_key = key;
  if existing.id is not null then
    if existing.submitted_by is distinct from auth.uid() then
      raise exception 'forbidden';
    end if;
    return query select existing.id, existing.status, false, true;
    return;
  end if;

  if not admin and payer is distinct from public.my_unit(h) then
    raise exception 'forbidden' using hint = 'You can only record payments for your own unit.';
  end if;
  if (p ->> 'method') <> 'cash' and (att is null or jsonb_typeof(att) <> 'object') and not admin then
    raise exception 'screenshot_required' using hint = 'Attach a screenshot of the payment.';
  end if;
  if att is not null and jsonb_typeof(att) = 'object' then
    if split_part(att ->> 'path', '/', 1) <> h::text or split_part(att ->> 'path', '/', 2) <> auth.uid()::text then
      raise exception 'invalid_attachment';
    end if;
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'payment-proofs' and o.name = att ->> 'path' and o.owner_id = auth.uid()::text
    ) then
      raise exception 'invalid_attachment' using hint = 'The screenshot upload could not be found. Upload it again.';
    end if;
    select exists (
      select 1 from public.payment_attachments a join public.payments x on x.id = a.payment_id
      where x.household_id = h and a.sha256 = att ->> 'sha256'
    ) into dup;
  end if;

  begin
    insert into public.payments (
      household_id, period_id, payer_unit_id, payer_member_id, recipient_unit_id, amount, paid_on, method,
      reference, related_expense_id, notes, status, idempotency_key, submitted_by
    ) values (
      h, (p ->> 'period_id')::uuid, payer, public.try_uuid(p ->> 'payer_member_id'), public.purse_holder(h),
      (p ->> 'amount')::numeric, (p ->> 'paid_on')::date, (p ->> 'method')::public.payment_method,
      nullif(trim(p ->> 'reference'), ''), public.try_uuid(p ->> 'related_expense_id'), nullif(p ->> 'notes', ''),
      'pending', key, auth.uid()
    ) returning payments.id into pid;
  exception when unique_violation then
    raise exception 'duplicate_reference' using hint = 'A payment with this transaction reference already exists.';
  end;

  if att is not null and jsonb_typeof(att) = 'object' then
    insert into public.payment_attachments (payment_id, storage_path, mime_type, size_bytes, sha256, uploaded_by)
    values (pid, att ->> 'path', att ->> 'mime', (att ->> 'size')::int, att ->> 'sha256', auth.uid());
  end if;

  return query select pid, 'pending'::public.payment_status, dup, false;
end $$;

create or replace function public.review_payment(payment_id uuid, decision public.payment_status, expected_version int, reason text default null)
returns table (id uuid, status public.payment_status, version int)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare pay record;
begin
  select * into pay from public.payments where payments.id = payment_id for update;
  if pay.id is null or not public.is_admin(pay.household_id) then
    raise exception 'forbidden';
  end if;
  if decision not in ('approved', 'rejected') then
    raise exception 'invalid_decision';
  end if;
  if pay.status <> 'pending' then
    raise exception 'already_reviewed' using hint = 'This payment has already been reviewed.';
  end if;
  if pay.version <> expected_version then
    raise exception 'conflict' using hint = 'This payment changed while you were reviewing it. Reload and try again.';
  end if;
  if decision = 'rejected' and coalesce(trim(reason), '') = '' then
    raise exception 'reason_required' using hint = 'Give a reason when rejecting a payment.';
  end if;

  update public.payments set status = decision where payments.id = payment_id;
  insert into public.payment_reviews (payment_id, decision, reason, reviewer_id)
  values (payment_id, decision, nullif(trim(reason), ''), auth.uid());

  return query select pm.id, pm.status, pm.version from public.payments pm where pm.id = payment_id;
end $$;

create or replace function public.ensure_period(h uuid, y int, m int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare pid uuid;
begin
  if not public.is_admin(h) and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  insert into public.periods (household_id, year, month, sheet_name)
  values (h, y, m, 'Grocery List - ' || to_char(make_date(y, m, 1), 'Mon YYYY'))
  on conflict (household_id, year, month) do nothing
  returning id into pid;
  if pid is null then
    select id into pid from public.periods where household_id = h and year = y and month = m;
  end if;
  return pid;
end $$;

create or replace function public.set_period_status(period_id uuid, new_status public.period_status) returns void
language plpgsql security definer set search_path = '' as $$
declare h uuid;
begin
  select household_id into h from public.periods where id = period_id;
  if h is null or not public.is_admin(h) then
    raise exception 'forbidden';
  end if;
  update public.periods set status = new_status, closed_at = case when new_status = 'closed' then now() end
  where id = period_id;
end $$;

-- sync worker (service role only)
create or replace function public.claim_sync_job(worker uuid, lease_seconds int default 120)
returns setof public.sync_jobs
language plpgsql security definer set search_path = '' as $$
declare
  h uuid;
  job public.sync_jobs;
begin
  for h in
    select distinct j.household_id from public.sync_jobs j
    where (j.status = 'pending' and j.next_attempt_at <= now())
       or (j.status = 'running' and j.lease_until < now())
  loop
    insert into public.sync_leases (household_id) values (h) on conflict do nothing;
    update public.sync_leases l set holder = worker, lease_until = now() + make_interval(secs => lease_seconds)
    where l.household_id = h and (l.lease_until < now() or l.holder = worker);
    if not found then
      continue;
    end if;

    delete from public.sync_jobs r
    where r.household_id = h and r.status = 'running' and r.lease_until < now()
      and exists (select 1 from public.sync_jobs q where q.household_id = h and q.scope = r.scope and q.status = 'pending');
    update public.sync_jobs r set status = 'pending', lease_until = null
    where r.household_id = h and r.status = 'running' and r.lease_until < now();

    select * into job from public.sync_jobs j
    where j.household_id = h and j.status = 'pending' and j.next_attempt_at <= now()
    order by j.id limit 1 for update skip locked;

    if job.id is null then
      update public.sync_leases set lease_until = '-infinity', holder = null where household_id = h;
      continue;
    end if;

    update public.sync_jobs set status = 'running', attempts = attempts + 1, started_at = now(),
      lease_until = now() + make_interval(secs => lease_seconds)
    where id = job.id returning * into job;
    return next job;
    return;
  end loop;
end $$;

create or replace function public.finish_sync_job(job_id bigint, worker uuid, ok boolean, error text default null, retry_at timestamptz default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  job public.sync_jobs;
  other bigint;
begin
  select * into job from public.sync_jobs where id = job_id for update;
  if job.id is null then
    return;
  end if;

  if ok then
    update public.sync_jobs set status = 'succeeded', finished_at = now(), lease_until = null, last_error = null where id = job_id;
    insert into public.sync_scope_state (household_id, scope, last_success_at, last_success_started_at)
    values (job.household_id, job.scope, now(), job.started_at)
    on conflict (household_id, scope) do update set last_success_at = now(), last_success_started_at = job.started_at, last_error = null;
  elsif retry_at is not null then
    select id into other from public.sync_jobs where household_id = job.household_id and scope = job.scope and status = 'pending';
    if other is not null then
      update public.sync_jobs set attempts = greatest(attempts, job.attempts), next_attempt_at = greatest(next_attempt_at, retry_at), last_error = error
      where id = other;
      update public.sync_jobs set status = 'failed', finished_at = now(), lease_until = null, last_error = coalesce(error, '') || ' (retry merged into job ' || other || ')'
      where id = job_id;
    else
      update public.sync_jobs set status = 'pending', next_attempt_at = retry_at, lease_until = null, last_error = error where id = job_id;
    end if;
  else
    update public.sync_jobs set status = 'failed', finished_at = now(), lease_until = null, last_error = error where id = job_id;
    insert into public.sync_scope_state (household_id, scope, last_failure_at, last_error)
    values (job.household_id, job.scope, now(), error)
    on conflict (household_id, scope) do update set last_failure_at = now(), last_error = error;
  end if;

  update public.sync_leases set lease_until = '-infinity', holder = null
  where household_id = job.household_id and holder = worker;
end $$;

create or replace function public.retry_sync(h uuid, s text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  sc text;
  n int := 0;
begin
  if not public.is_admin(h) then
    raise exception 'forbidden';
  end if;
  for sc in
    select st.scope from public.sync_scope_state st
    where st.household_id = h and (s is null or st.scope = s)
      and (s is not null or (st.last_failure_at is not null and st.last_failure_at > coalesce(st.last_success_at, '-infinity')))
  loop
    perform public.enqueue_sync(h, sc);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.claim_sync_job(uuid, int) from public, anon, authenticated;
revoke execute on function public.finish_sync_job(bigint, uuid, boolean, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.enqueue_sync(uuid, text) from public, anon, authenticated;
revoke execute on function public.validate_split(uuid, jsonb, numeric) from public, anon;

-- ===== 20261019000004_rls_storage.sql =====
do $$
declare t text;
begin
  foreach t in array array[
    'households', 'units', 'members', 'household_roles', 'household_invites', 'periods', 'expense_sections',
    'split_rules', 'split_rule_parts', 'expense_categories', 'expenses', 'payments', 'payment_attachments',
    'payment_reviews', 'meal_slots', 'sabzi_options', 'kitchen_notes', 'duty_days', 'app_settings',
    'excel_connection', 'excel_sheets', 'sync_jobs', 'sync_scope_state', 'sync_runs', 'sync_leases', 'audit_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- read access for every household member
create policy households_read on public.households for select to authenticated using (public.is_member(id));
create policy units_read on public.units for select to authenticated using (public.is_member(household_id));
create policy periods_read on public.periods for select to authenticated using (public.is_member(household_id));
create policy sections_read on public.expense_sections for select to authenticated using (public.is_member(household_id));
create policy rules_read on public.split_rules for select to authenticated using (public.is_member(household_id));
create policy rule_parts_read on public.split_rule_parts for select to authenticated
  using (exists (select 1 from public.split_rules r where r.id = rule_id and public.is_member(r.household_id)));
create policy categories_read on public.expense_categories for select to authenticated using (public.is_member(household_id));
create policy meal_slots_read on public.meal_slots for select to authenticated using (public.is_member(household_id));
create policy sabzi_read on public.sabzi_options for select to authenticated using (public.is_member(household_id));
create policy kitchen_notes_read on public.kitchen_notes for select to authenticated using (public.is_member(household_id));
create policy duty_days_read on public.duty_days for select to authenticated using (public.is_member(household_id));
create policy settings_read on public.app_settings for select to authenticated using (public.is_member(household_id));
create policy members_read on public.members for select to authenticated using (public.is_member(household_id));
create policy roles_read on public.household_roles for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin(household_id));

-- admin-managed configuration (financial rows go through RPCs)
create policy units_admin_write on public.units for all to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));
create policy members_admin_write on public.members for all to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));
create policy roles_admin_write on public.household_roles for all to authenticated
  using (public.is_admin(household_id) and user_id <> (select auth.uid()))
  with check (public.is_admin(household_id) and user_id <> (select auth.uid()));
create policy invites_admin on public.household_invites for all to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));
create policy rules_admin_write on public.split_rules for all to authenticated
  using (public.is_admin(household_id) and not is_system) with check (public.is_admin(household_id) and not is_system);
create policy rule_parts_admin_write on public.split_rule_parts for all to authenticated
  using (exists (select 1 from public.split_rules r where r.id = rule_id and public.is_admin(r.household_id) and not r.is_system))
  with check (exists (select 1 from public.split_rules r where r.id = rule_id and public.is_admin(r.household_id) and not r.is_system));
create policy categories_admin_write on public.expense_categories for all to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));
create policy meal_slots_admin_write on public.meal_slots for all to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));
create policy sabzi_admin_write on public.sabzi_options for all to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));
create policy kitchen_notes_admin_write on public.kitchen_notes for all to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));
create policy duty_days_admin_write on public.duty_days for all to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));
create policy settings_admin_write on public.app_settings for update to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));

-- expenses: admins always, members when the household allows it
create policy expenses_read on public.expenses for select to authenticated
  using (public.is_admin(household_id)
         or (public.is_member(household_id) and public.setting_enabled(household_id, 'members_see_all_expenses')));

-- payments: admins, the payer unit, or everyone when balances are shared (screenshots stay private, see storage)
create policy payments_read on public.payments for select to authenticated
  using (public.is_admin(household_id)
         or payer_unit_id = public.my_unit(household_id)
         or (public.is_member(household_id) and public.setting_enabled(household_id, 'members_see_all_balances')));
create policy attachments_read on public.payment_attachments for select to authenticated
  using (exists (
    select 1 from public.payments p where p.id = payment_id
      and (public.is_admin(p.household_id) or p.payer_unit_id = public.my_unit(p.household_id))));
create policy reviews_read on public.payment_reviews for select to authenticated
  using (exists (
    select 1 from public.payments p where p.id = payment_id
      and (public.is_admin(p.household_id) or p.payer_unit_id = public.my_unit(p.household_id))));

-- sync + audit: admins read, only the service role writes
create policy excel_sheets_admin_read on public.excel_sheets for select to authenticated using (public.is_admin(household_id));
create policy sync_jobs_admin_read on public.sync_jobs for select to authenticated using (public.is_admin(household_id));
create policy sync_state_member_read on public.sync_scope_state for select to authenticated using (public.is_member(household_id));
create policy sync_runs_admin_read on public.sync_runs for select to authenticated using (public.is_admin(household_id));
create policy audit_admin_read on public.audit_log for select to authenticated using (public.is_admin(household_id));

create view public.excel_connection_public with (security_invoker = true) as
  select household_id, account_email, drive_id, item_id, file_name, web_url, token_updated_at, connected_at,
         token_updated_at is not null as has_token
  from public.excel_connection;
create policy excel_connection_admin_read on public.excel_connection for select to authenticated using (public.is_admin(household_id));
revoke select on public.excel_connection from authenticated, anon;
grant select (household_id, account_email, drive_id, item_id, file_name, web_url, token_updated_at, connected_at)
  on public.excel_connection to authenticated;
grant select on public.excel_connection_public to authenticated;

-- private storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('payment-proofs', 'payment-proofs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']),
  ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy proofs_insert_own on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and public.is_member(public.try_uuid((storage.foldername(name))[1]))
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

create policy proofs_read on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (
      public.is_admin(public.try_uuid((storage.foldername(name))[1]))
      or (storage.foldername(name))[2] = (select auth.uid())::text
      or exists (
        select 1 from public.payment_attachments a join public.payments p on p.id = a.payment_id
        where a.storage_path = name and p.payer_unit_id = public.my_unit(p.household_id)
      )
    )
  );

create policy receipts_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_admin(public.try_uuid((storage.foldername(name))[1])));

create policy receipts_read on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and (
      public.is_admin(public.try_uuid((storage.foldername(name))[1]))
      or (public.is_member(public.try_uuid((storage.foldername(name))[1]))
          and public.setting_enabled(public.try_uuid((storage.foldername(name))[1]), 'members_see_all_expenses'))
    )
  );

-- ===== 20261019000005_bootstrap.sql =====
create or replace function public.bootstrap_household(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  h uuid;
  x jsonb;
  y jsonb;
  rid uuid;
  ids jsonb := '{}'::jsonb;
  units jsonb := '{}'::jsonb;
  sections jsonb := '{}'::jsonb;
  rules jsonb := '{}'::jsonb;
  cats jsonb := '{}'::jsonb;
  new_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  insert into public.households (name) values (p ->> 'name') returning id into h;
  insert into public.app_settings (household_id) values (h);
  insert into public.sync_leases (household_id) values (h);

  for x in select * from jsonb_array_elements(p -> 'units') loop
    insert into public.units (household_id, code, name, sort_order, is_purse_holder)
    values (h, x ->> 'code', x ->> 'name', (x ->> 'sortOrder')::int, coalesce((x ->> 'isPurseHolder')::boolean, false))
    returning id into new_id;
    units := units || jsonb_build_object(x ->> 'code', new_id);
  end loop;

  for x in select * from jsonb_array_elements(p -> 'sections') loop
    insert into public.expense_sections (household_id, key, title, sort_order)
    values (h, x ->> 'key', x ->> 'title', (x ->> 'sortOrder')::int)
    returning id into new_id;
    sections := sections || jsonb_build_object(x ->> 'key', new_id);
  end loop;

  for x in select * from jsonb_array_elements(p -> 'rules') loop
    insert into public.split_rules (household_id, name, code, type, description, is_system)
    values (h, x ->> 'name', x ->> 'key', (x ->> 'type')::public.split_type, x ->> 'description', coalesce((x ->> 'isSystem')::boolean, true))
    returning id into rid;
    for y in select * from jsonb_array_elements(coalesce(x -> 'parts', '[]'::jsonb)) loop
      insert into public.split_rule_parts (rule_id, unit_id, num, den, percent)
      values (rid, (units ->> (y ->> 'unit'))::uuid, (y ->> 'num')::int, (y ->> 'den')::int, (y ->> 'percent')::numeric);
    end loop;
    rules := rules || jsonb_build_object(x ->> 'key', rid);
  end loop;

  for x in select * from jsonb_array_elements(p -> 'categories') loop
    insert into public.expense_categories (household_id, name, section_id, default_split_rule_id, icon, sort_order)
    values (h, x ->> 'name', (sections ->> (x ->> 'section'))::uuid, (rules ->> (x ->> 'rule'))::uuid, x ->> 'icon', (x ->> 'sortOrder')::int)
    returning id into new_id;
    cats := cats || jsonb_build_object(x ->> 'key', new_id);
  end loop;

  return jsonb_build_object('householdId', h, 'units', units, 'sections', sections, 'rules', rules, 'categories', cats);
end $$;

revoke execute on function public.bootstrap_household(jsonb) from public, anon, authenticated;

-- ===== 20261019000006_invites.sql =====
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

-- ===== 20261019000007_import.sql =====
alter table public.households add column import_fingerprint text unique;

create or replace function public.import_workbook(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  boot jsonb;
  h uuid;
  pid uuid;
  x jsonb;
  mid uuid;
  labels jsonb := '{}'::jsonb;
  admin_member uuid;
  purse uuid;
  pay_id uuid;
  i int := 0;
  lbl text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if exists (select 1 from public.households where import_fingerprint = p ->> 'fingerprint') then
    raise exception 'already_imported' using hint = 'This workbook has already been imported.';
  end if;

  boot := public.bootstrap_household(p -> 'bootstrap');
  h := (boot ->> 'householdId')::uuid;
  update public.households set import_fingerprint = p ->> 'fingerprint' where id = h;
  purse := (boot -> 'units' ->> (p ->> 'purseHolder'))::uuid;

  for x in select * from jsonb_array_elements(p -> 'members') loop
    insert into public.members (household_id, unit_id, full_name, email, relation, duty_label, joined_on)
    values (h, (boot -> 'units' ->> (x ->> 'unit'))::uuid, x ->> 'fullName', nullif(x ->> 'email', ''), nullif(x ->> 'relation', ''),
            nullif(x ->> 'dutyLabel', ''), coalesce(nullif(x ->> 'joinedOn', '')::date, current_date))
    returning id into mid;
    if nullif(x ->> 'dutyLabel', '') is not null then
      labels := labels || jsonb_build_object(x ->> 'dutyLabel', mid);
    end if;
    if coalesce((x ->> 'admin')::boolean, false) then
      admin_member := mid;
      insert into public.household_invites (household_id, member_id, email, role)
      values (h, mid, lower(x ->> 'email'), 'admin');
    end if;
  end loop;
  if admin_member is null then
    raise exception 'invalid_import' using hint = 'Mark one member as the administrator.';
  end if;

  insert into public.periods (household_id, year, month, sheet_name)
  values (h, (p -> 'period' ->> 'year')::int, (p -> 'period' ->> 'month')::int, p -> 'period' ->> 'sheetName')
  returning id into pid;

  for x in select * from jsonb_array_elements(p -> 'expenses') loop
    i := i + 1;
    insert into public.expenses (
      household_id, period_id, section_id, category_id, title, qty_text, qty_num, rate, amount, split_rule_id,
      paid_by_unit_id, notes, sort_order, source
    ) values (
      h, pid, (boot -> 'sections' ->> (x ->> 'section'))::uuid, (boot -> 'categories' ->> (x ->> 'category'))::uuid,
      x ->> 'title', nullif(x ->> 'qtyText', ''), nullif(x ->> 'qtyNum', '')::numeric, nullif(x ->> 'rate', '')::numeric,
      nullif(x ->> 'amount', '')::numeric, (boot -> 'rules' ->> (x ->> 'rule'))::uuid, purse, nullif(x ->> 'notes', ''), i, 'import'
    );
  end loop;

  for x in select * from jsonb_array_elements(p -> 'payments') loop
    insert into public.payments (
      household_id, period_id, payer_unit_id, recipient_unit_id, amount, paid_on, method, notes, status, source, idempotency_key
    ) values (
      h, pid, (boot -> 'units' ->> (x ->> 'unit'))::uuid, purse, (x ->> 'amount')::numeric, (x ->> 'paidOn')::date, 'other',
      'Imported from the workbook''s Paid column', 'approved', 'import', gen_random_uuid()
    ) returning id into pay_id;
    insert into public.payment_reviews (payment_id, decision, reason)
    values (pay_id, 'approved', 'Imported from the workbook');
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p -> 'menu', '[]')) loop
    insert into public.meal_slots (household_id, week, weekday, fixed_category, dish)
    values (h, (x ->> 'week')::int, (x ->> 'weekday')::int, coalesce(x ->> 'fixedCategory', ''), coalesce(x ->> 'dish', ''));
  end loop;
  i := 0;
  for x in select * from jsonb_array_elements(coalesce(p -> 'sabzi', '[]')) loop
    i := i + 1;
    insert into public.sabzi_options (household_id, name, sort_order) values (h, x #>> '{}', i) on conflict do nothing;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p -> 'duties', '[]')) loop
    foreach lbl in array array[x ->> 'breakfast', x ->> 'lunch', x ->> 'dinner', x ->> 'off'] loop
      if lbl is not null and lbl <> '' and not labels ? lbl then
        raise exception 'invalid_import' using hint = format('Kitchen duty label %s is not assigned to any member.', lbl);
      end if;
    end loop;
    insert into public.duty_days (household_id, day, breakfast_member_id, lunch_member_id, dinner_member_id, off_member_id, off_note)
    values (h, (x ->> 'day')::date, (labels ->> (x ->> 'breakfast'))::uuid, (labels ->> (x ->> 'lunch'))::uuid,
            (labels ->> (x ->> 'dinner'))::uuid, (labels ->> (x ->> 'off'))::uuid, nullif(x ->> 'offNote', ''));
  end loop;

  i := 0;
  for x in select * from jsonb_array_elements(coalesce(p -> 'dutyNotes', '[]')) loop
    i := i + 1;
    insert into public.kitchen_notes (household_id, scope, sort_order, body) values (h, 'duties:' || (p ->> 'dutyMonth'), i, x #>> '{}');
  end loop;

  insert into public.excel_sheets (household_id, scope, worksheet_name) values
    (h, 'period:' || pid, p -> 'period' ->> 'sheetName'),
    (h, 'menu', 'Weekly Food Schedule');
  if p ->> 'dutyMonth' is not null then
    insert into public.excel_sheets (household_id, scope, worksheet_name) values (h, 'duties:' || (p ->> 'dutyMonth'), 'Kitchen Duties');
  end if;

  perform public.link_existing_user(lower(x2.email)) from public.household_invites x2 where x2.household_id = h;
  return h;
end $$;

revoke execute on function public.import_workbook(jsonb) from public, anon, authenticated;

-- ===== 20261020000008_direct_payments.sql =====
-- Expenses paid directly by a household other than the purse-holder carry one linked contribution payment.
-- It is created as pending, waits for the administrator's approval on the Payments page, and follows the
-- expense through edits and deletion. A change to the amount or payer sends an approved payment back to pending.

alter table public.payments add column auto_from_expense boolean not null default false;

update public.payments
set auto_from_expense = true
where related_expense_id is not null and source = 'app' and notes like 'Paid directly for:%';

create unique index payments_one_auto_per_expense on public.payments (related_expense_id) where auto_from_expense;

create or replace function public.sync_direct_payment(eid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e record;
  pay record;
  purse uuid;
  wanted boolean;
  changed boolean;
begin
  select * into e from public.expenses where id = eid;
  if e.id is null then
    return;
  end if;
  purse := public.purse_holder(e.household_id);
  wanted := e.deleted_at is null and e.paid_by_unit_id is distinct from purse and coalesce(e.amount, 0) > 0;
  select * into pay from public.payments where related_expense_id = eid and auto_from_expense for update;

  if wanted and pay.id is null then
    insert into public.payments (
      household_id, period_id, payer_unit_id, recipient_unit_id, amount, paid_on, method, related_expense_id,
      notes, status, idempotency_key, submitted_by, auto_from_expense
    ) values (
      e.household_id, e.period_id, e.paid_by_unit_id, purse, e.amount, coalesce(e.expense_date, current_date), 'other', eid,
      'Paid directly for: ' || e.title, 'pending', gen_random_uuid(), auth.uid(), true
    );
  elsif wanted then
    changed := (pay.payer_unit_id, pay.amount, pay.period_id) is distinct from (e.paid_by_unit_id, e.amount, e.period_id);
    if changed then
      update public.payments
      set payer_unit_id = e.paid_by_unit_id, amount = e.amount, period_id = e.period_id, status = 'pending',
          notes = 'Paid directly for: ' || e.title
      where id = pay.id;
    elsif pay.notes is distinct from 'Paid directly for: ' || e.title then
      update public.payments set notes = 'Paid directly for: ' || e.title where id = pay.id;
    end if;
  elsif pay.id is not null then
    delete from public.payments where id = pay.id;
  end if;
end $$;

revoke execute on function public.sync_direct_payment(uuid) from public, anon, authenticated;

-- Expenses already marked as paid by another household but missing their payment
-- (edited before this change) get a pending payment now.
do $$
declare r record;
begin
  for r in
    select e.id from public.expenses e
    where e.deleted_at is null and coalesce(e.amount, 0) > 0
      and e.paid_by_unit_id is distinct from public.purse_holder(e.household_id)
      and not exists (select 1 from public.payments p where p.related_expense_id = e.id and p.auto_from_expense)
  loop
    perform public.sync_direct_payment(r.id);
  end loop;
end $$;


create or replace function public.upsert_expense(p jsonb) returns table (id uuid, version int)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  h uuid := (p ->> 'household_id')::uuid;
  eid uuid := public.try_uuid(p ->> 'id');
  qty numeric := nullif(p ->> 'qty_num', '')::numeric;
  rt numeric := nullif(p ->> 'rate', '')::numeric;
  amt numeric := nullif(p ->> 'amount', '')::numeric;
  rule uuid := public.try_uuid(p ->> 'split_rule_id');
  override jsonb := case when jsonb_typeof(p -> 'split_override') = 'object' then p -> 'split_override' end;
  payer uuid := coalesce(public.try_uuid(p ->> 'paid_by_unit_id'), public.purse_holder(h));
  res record;
begin
  if not public.is_admin(h) then
    raise exception 'forbidden' using hint = 'Only administrators can change expenses.';
  end if;
  if rt is not null then
    if qty is null then
      raise exception 'invalid_expense' using hint = 'Quantity is required when a rate is set.';
    end if;
    amt := round(qty * rt, 2);
  end if;
  if (rule is null) = (override is null) then
    raise exception 'invalid_expense' using hint = 'Choose a split rule or a custom split.';
  end if;
  if override is not null then
    perform public.validate_split(h, override, amt);
  end if;

  if eid is null then
    insert into public.expenses (
      household_id, period_id, section_id, category_id, title, description, qty_text, qty_num, rate, amount,
      split_rule_id, split_override, expense_date, paid_by_unit_id, receipt_path, notes, sort_order,
      created_by, updated_by
    ) values (
      h, (p ->> 'period_id')::uuid, (p ->> 'section_id')::uuid, public.try_uuid(p ->> 'category_id'),
      trim(p ->> 'title'), nullif(p ->> 'description', ''), nullif(p ->> 'qty_text', ''), qty, rt, amt,
      rule, override, nullif(p ->> 'expense_date', '')::date, payer, nullif(p ->> 'receipt_path', ''),
      nullif(p ->> 'notes', ''),
      coalesce((p ->> 'sort_order')::int,
        (select coalesce(max(e.sort_order), 0) + 1 from public.expenses e
         where e.period_id = (p ->> 'period_id')::uuid and e.section_id = (p ->> 'section_id')::uuid)),
      auth.uid(), auth.uid()
    ) returning expenses.id, expenses.version into res;
  else
    update public.expenses e set
      period_id = (p ->> 'period_id')::uuid,
      section_id = (p ->> 'section_id')::uuid,
      category_id = public.try_uuid(p ->> 'category_id'),
      title = trim(p ->> 'title'),
      description = nullif(p ->> 'description', ''),
      qty_text = nullif(p ->> 'qty_text', ''),
      qty_num = qty,
      rate = rt,
      amount = amt,
      split_rule_id = rule,
      split_override = override,
      expense_date = nullif(p ->> 'expense_date', '')::date,
      paid_by_unit_id = payer,
      receipt_path = coalesce(nullif(p ->> 'receipt_path', ''), e.receipt_path),
      notes = nullif(p ->> 'notes', ''),
      sort_order = coalesce((p ->> 'sort_order')::int, e.sort_order),
      updated_by = auth.uid()
    where e.id = eid and e.household_id = h and e.deleted_at is null
      and e.version = (p ->> 'expected_version')::int
    returning e.id, e.version into res;
    if not found then
      raise exception 'conflict' using hint = 'This expense was changed by someone else. Reload and try again.';
    end if;
  end if;

  perform public.sync_direct_payment(res.id);
  return query select res.id, res.version;
end $$;

create or replace function public.delete_expense(expense_id uuid, expected_version int) returns void
language plpgsql security definer set search_path = '' as $$
declare h uuid;
begin
  select household_id into h from public.expenses where id = expense_id;
  if h is null or not public.is_admin(h) then
    raise exception 'forbidden';
  end if;
  update public.expenses set deleted_at = now(), updated_by = auth.uid()
  where id = expense_id and version = expected_version and deleted_at is null;
  if not found then
    raise exception 'conflict' using hint = 'This expense was changed by someone else. Reload and try again.';
  end if;
  perform public.sync_direct_payment(expense_id);
end $$;


-- ===== 20261021000009_utility_bills.sql =====
-- Electricity meters (LESCO) and the bills fetched for them.

create table public.utility_meters (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  provider text not null default 'lesco' check (provider in ('lesco')),
  label text not null check (length(btrim(label)) between 1 and 60),
  reference_no text not null check (reference_no ~ '^[0-9]{14}$'),
  category_id uuid references public.expense_categories(id) on delete set null,
  active boolean not null default true,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (household_id, provider, reference_no)
);

create table public.utility_bills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  meter_id uuid not null references public.utility_meters(id) on delete cascade,
  bill_month date not null check (extract(day from bill_month) = 1),
  reading_date date,
  issue_date date,
  due_date date,
  units integer,
  payable numeric(14, 2) not null check (payable >= 0),
  current_bill numeric(14, 2),
  late_payments jsonb not null default '[]'::jsonb,
  snapshot_path text,
  expense_id uuid references public.expenses(id) on delete set null,
  fetched_at timestamptz not null default now(),
  unique (meter_id, bill_month)
);

create index utility_bills_household_month on public.utility_bills (household_id, bill_month desc);

alter table public.utility_meters enable row level security;
alter table public.utility_bills enable row level security;

create policy utility_meters_read on public.utility_meters for select to authenticated using (public.is_member(household_id));
create policy utility_meters_admin_write on public.utility_meters for all to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));

-- Bills are written by the server's bill checker; admins may only link a bill to an expense.
create policy utility_bills_read on public.utility_bills for select to authenticated using (public.is_member(household_id));
create policy utility_bills_admin_link on public.utility_bills for update to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));
revoke update on public.utility_bills from authenticated;
grant update (expense_id) on public.utility_bills to authenticated;

create trigger utility_meters_audit after insert or update or delete on public.utility_meters
  for each row execute function public.tg_audit();
create trigger utility_bills_audit after insert or update or delete on public.utility_bills
  for each row execute function public.tg_audit();

-- Saved copies of the bills. No client policies: the server reads them after checking access.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('utility-bills', 'utility-bills', false, 2097152, array['text/plain'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ===== 20261021000010_more_utilities.sql =====
-- WASA (water) and SNGPL (gas) alongside LESCO. SNGPL bills are uploaded because its site requires a CAPTCHA.

alter table public.utility_meters drop constraint if exists utility_meters_provider_check;
alter table public.utility_meters drop constraint if exists utility_meters_reference_no_check;
alter table public.utility_meters add constraint utility_meters_provider_check check (provider in ('lesco', 'wasa', 'sngpl'));
alter table public.utility_meters add constraint utility_meters_reference_no_check check (
  (provider = 'lesco' and reference_no ~ '^[0-9]{14}$')
  or (provider = 'sngpl' and reference_no ~ '^[0-9]{11}$')
  or (provider = 'wasa' and reference_no ~ '^[0-9]{4,15}$')
);

alter table public.utility_bills add column source text not null default 'fetched' check (source in ('fetched', 'upload'));
alter table public.utility_bills add column snapshot_mime text not null default 'text/html'
  check (snapshot_mime in ('text/html', 'image/jpeg', 'image/png', 'image/webp', 'application/pdf'));

update storage.buckets
set file_size_limit = 6291456,
    allowed_mime_types = array['text/plain', 'image/jpeg', 'image/png', 'image/webp', 'application/pdf']
where id = 'utility-bills';

-- ===== 20261022000011_personal_expenses.sql =====
-- Personal spending: private to the person who records it. No admin access, no audit copies, no sheet sync.

create table public.personal_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 40),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index personal_categories_user_name on public.personal_categories (user_id, lower(name));

create table public.personal_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid references public.personal_categories(id) on delete set null,
  amount numeric(14, 2) not null check (amount > 0 and amount < 100000000),
  spent_on date not null,
  note text check (note is null or length(note) <= 200),
  receipt_path text,
  receipt_mime text check (receipt_mime is null or receipt_mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (receipt_path is null or split_part(receipt_path, '/', 1) = user_id::text)
);
create index personal_expenses_user_date on public.personal_expenses (user_id, spent_on desc);

create table public.personal_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid references public.personal_categories(id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0 and amount < 100000000),
  created_at timestamptz not null default now()
);
create unique index personal_budgets_user_category on public.personal_budgets (user_id, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.personal_categories enable row level security;
alter table public.personal_expenses enable row level security;
alter table public.personal_budgets enable row level security;

create policy personal_categories_own on public.personal_categories for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy personal_expenses_own on public.personal_expenses for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy personal_budgets_own on public.personal_budgets for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Receipts live under {user id}/... and only that user can touch them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('personal-receipts', 'personal-receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy personal_receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'personal-receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy personal_receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'personal-receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy personal_receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'personal-receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ===== 20261022000012_meter_readings.sql =====
-- Meter Watch: readings between bills so each LESCO meter can stay under its monthly unit limit.

alter table public.utility_bills add column previous_reading integer check (previous_reading is null or previous_reading >= 0);
alter table public.utility_bills add column present_reading integer check (present_reading is null or present_reading >= 0);
alter table public.utility_bills add column history jsonb not null default '[]'::jsonb;

alter table public.utility_meters add column unit_limit integer not null default 200 check (unit_limit between 1 and 10000);

create table public.meter_readings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  meter_id uuid not null references public.utility_meters(id) on delete cascade,
  reading integer not null check (reading between 0 and 9999999),
  read_at timestamptz not null default now(),
  photo_path text,
  recorded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (photo_path is null or split_part(photo_path, '/', 1) = household_id::text)
);
create index meter_readings_meter_time on public.meter_readings (meter_id, read_at desc);

alter table public.meter_readings enable row level security;

-- Everyone in the household can see and add readings; a reading can be removed by whoever added it or an admin.
create policy meter_readings_read on public.meter_readings for select to authenticated using (public.is_member(household_id));
create policy meter_readings_add on public.meter_readings for insert to authenticated
  with check (
    public.is_member(household_id)
    and recorded_by = (select auth.uid())
    and exists (select 1 from public.utility_meters m where m.id = meter_id and m.household_id = meter_readings.household_id)
  );
create policy meter_readings_remove on public.meter_readings for delete to authenticated
  using (recorded_by = (select auth.uid()) or public.is_admin(household_id));

create trigger meter_readings_audit after insert or update or delete on public.meter_readings
  for each row execute function public.tg_audit();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meter-photos', 'meter-photos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy meter_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'meter-photos' and public.is_member(public.try_uuid((storage.foldername(name))[1])));
create policy meter_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'meter-photos' and public.is_member(public.try_uuid((storage.foldername(name))[1])));
create policy meter_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'meter-photos' and (owner_id = (select auth.uid())::text or public.is_admin(public.try_uuid((storage.foldername(name))[1]))));

-- ===== 20261023000013_notifications.sql =====
-- Push notifications, the in-app notification list, per-person preferences and reminders.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  user_agent text check (user_agent is null or length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  failures integer not null default 0
);
alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_member(household_id));

create table public.notification_prefs (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  quiet_start time not null default '22:00',
  quiet_end time not null default '08:00',
  payments boolean not null default true,
  bills boolean not null default true,
  meters boolean not null default true,
  money boolean not null default true,
  summary boolean not null default true,
  reminders boolean not null default true,
  personal boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
create policy notification_prefs_own on public.notification_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('payments', 'bills', 'meters', 'money', 'summary', 'reminders', 'personal', 'test')),
  title text not null check (length(title) <= 120),
  body text check (body is null or length(body) <= 300),
  url text check (url is null or url ~ '^/'),
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  deliver_after timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz,
  unique (user_id, dedupe_key)
);
create index notifications_user_recent on public.notifications (user_id, created_at desc);
create index notifications_undelivered on public.notifications (deliver_after) where sent_at is null;
alter table public.notifications enable row level security;
create policy notifications_own_read on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_own_mark on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  audience text not null default 'me' check (audience in ('me', 'family')),
  title text not null check (length(btrim(title)) between 1 and 80),
  note text check (note is null or length(note) <= 200),
  next_at timestamptz not null,
  repeat text not null default 'none' check (repeat in ('none', 'daily', 'weekly', 'monthly')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index reminders_due on public.reminders (next_at) where active;
alter table public.reminders enable row level security;
create policy reminders_read on public.reminders for select to authenticated
  using (created_by = (select auth.uid()) or (audience = 'family' and public.is_member(household_id)));
create policy reminders_add on public.reminders for insert to authenticated
  with check (created_by = (select auth.uid()) and public.is_member(household_id));
create policy reminders_change on public.reminders for update to authenticated
  using (created_by = (select auth.uid()) or (audience = 'family' and public.is_admin(household_id)))
  with check (created_by = (select auth.uid()) or (audience = 'family' and public.is_admin(household_id)));
create policy reminders_remove on public.reminders for delete to authenticated
  using (created_by = (select auth.uid()) or (audience = 'family' and public.is_admin(household_id)));

-- ===== 20261024000014_personal_plans.sql =====
-- Planned personal spending for a month: private to its owner, like personal_expenses.

create table public.personal_plan_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  category_id uuid references public.personal_categories(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 80),
  estimate numeric(14, 2) not null check (estimate > 0 and estimate < 100000000),
  due_date date check (due_date is null or (due_date >= month and due_date < (month + interval '1 month'))),
  repeat_monthly boolean not null default false,
  status text not null default 'planned' check (status in ('planned', 'bought', 'skipped')),
  expense_id uuid references public.personal_expenses(id) on delete set null,
  reminded_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index personal_plan_items_user_month on public.personal_plan_items (user_id, month);
create index personal_plan_items_due on public.personal_plan_items (due_date) where status = 'planned' and reminded_at is null;

alter table public.personal_plan_items enable row level security;
create policy personal_plan_items_own on public.personal_plan_items for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (expense_id is null or exists (select 1 from public.personal_expenses e where e.id = expense_id and e.user_id = (select auth.uid())))
    and (category_id is null or exists (select 1 from public.personal_categories c where c.id = category_id and c.user_id = (select auth.uid())))
  );

-- ---- 20261024000015_category_kind.sql ----
-- Group expense categories into essential (must-pay) and variable (food that changes month to month)
-- for the dashboard filter. View only: it doesn't change any split.

alter table public.expense_categories
  add column if not exists kind text not null default 'essential' check (kind in ('essential', 'variable'));

update public.expense_categories
set kind = 'variable'
where kind = 'essential'
  and (name ilike 'milk%' or name ilike '%sabzi%' or name ilike 'vegetable%' or name ilike '%chicken%' or name ilike '%meat%');

-- ===== 20261025000016_personal_salaries.sql =====
-- Staff a person pays from their own pocket (driver, maid, tutor) and what they paid each month.
-- Private to the owner, like personal_expenses. Each payment also has a matching personal expense.

create table public.personal_staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  role text check (role is null or length(role) <= 40),
  monthly_salary numeric(14, 2) not null check (monthly_salary > 0 and monthly_salary < 100000000),
  pay_day integer check (pay_day is null or pay_day between 1 and 31),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index personal_staff_user on public.personal_staff (user_id);

create table public.personal_salary_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  staff_id uuid not null references public.personal_staff(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  kind text not null default 'salary' check (kind in ('salary', 'advance', 'bonus')),
  amount numeric(14, 2) not null check (amount > 0 and amount < 100000000),
  paid_on date not null,
  note text check (note is null or length(note) <= 200),
  expense_id uuid references public.personal_expenses(id) on delete set null,
  created_at timestamptz not null default now()
);
create index personal_salary_payments_user_month on public.personal_salary_payments (user_id, month);
create index personal_salary_payments_staff on public.personal_salary_payments (staff_id);

alter table public.personal_staff enable row level security;
alter table public.personal_salary_payments enable row level security;

create policy personal_staff_own on public.personal_staff for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy personal_salary_payments_own on public.personal_salary_payments for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.personal_staff s where s.id = staff_id and s.user_id = (select auth.uid()))
    and (expense_id is null or exists (select 1 from public.personal_expenses e where e.id = expense_id and e.user_id = (select auth.uid())))
  );

-- New categories for people who already have their list.
insert into public.personal_categories (user_id, name, sort_order)
select u.user_id, n.name, n.sort_order
from (select distinct user_id from public.personal_categories) u
cross join (values ('School', 8), ('Salaries', 9)) as n(name, sort_order)
on conflict (user_id, lower(name)) do nothing;
