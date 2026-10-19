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
