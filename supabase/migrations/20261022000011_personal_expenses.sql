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
