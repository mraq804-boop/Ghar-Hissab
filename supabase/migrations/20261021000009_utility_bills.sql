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
