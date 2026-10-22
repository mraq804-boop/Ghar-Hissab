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
