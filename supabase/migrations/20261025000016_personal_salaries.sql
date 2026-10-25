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
