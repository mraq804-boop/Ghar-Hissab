create table public.abbu_money (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  kind text not null check (kind in ('paid', 'returned')),
  amount numeric(14, 2) not null check (amount > 0 and amount < 100000000),
  on_date date not null default current_date,
  note text check (note is null or length(note) <= 200),
  expense_id uuid unique references public.expenses(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (expense_id is null or kind = 'paid')
);
create index abbu_money_household on public.abbu_money (household_id, on_date desc);

alter table public.abbu_money enable row level security;

create policy abbu_money_read on public.abbu_money for select to authenticated using (public.is_member(household_id));
create policy abbu_money_admin_write on public.abbu_money for all to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));
