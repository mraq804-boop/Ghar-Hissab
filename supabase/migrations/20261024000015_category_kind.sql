-- Group expense categories into essential (must-pay) and variable (food that changes month to month)
-- for the dashboard filter. View only: it doesn't change any split.

alter table public.expense_categories
  add column if not exists kind text not null default 'essential' check (kind in ('essential', 'variable'));

update public.expense_categories
set kind = 'variable'
where kind = 'essential'
  and (name ilike 'milk%' or name ilike '%sabzi%' or name ilike 'vegetable%' or name ilike '%chicken%' or name ilike '%meat%');
