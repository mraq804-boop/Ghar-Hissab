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
