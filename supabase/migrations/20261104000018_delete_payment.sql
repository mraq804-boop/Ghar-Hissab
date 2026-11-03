-- Administrators can remove a payment that was recorded by mistake, whatever its status. The audit log keeps
-- a copy of the removed row. Payments created for an expense follow that expense, so they are changed there,
-- and payments in a closed month stay as they are until the month is reopened. Returns the screenshot paths
-- so the caller can remove the files from storage.

create or replace function public.delete_payment(payment_id uuid, expected_version int)
returns table (path text)
language plpgsql security definer set search_path = '' as $$
declare
  pay record;
  paths text[];
begin
  select * into pay from public.payments p where p.id = payment_id for update;
  if pay.id is null or not public.is_admin(pay.household_id) then
    raise exception 'forbidden';
  end if;
  if pay.auto_from_expense then
    raise exception 'linked_to_expense' using hint = 'This payment was made for an expense. Change who paid on that expense, or delete the expense.';
  end if;
  if exists (select 1 from public.periods pr where pr.id = pay.period_id and pr.status = 'closed') then
    raise exception 'period_closed' using hint = 'This month is closed. Reopen it before removing its payments.';
  end if;
  if pay.version <> expected_version then
    raise exception 'conflict' using hint = 'This payment changed while you were looking at it. Reload and try again.';
  end if;

  select coalesce(array_agg(a.storage_path), '{}') into paths from public.payment_attachments a where a.payment_id = pay.id;
  delete from public.payments p where p.id = pay.id;
  return query select unnest(paths);
end $$;

revoke execute on function public.delete_payment(uuid, int) from public, anon;
grant execute on function public.delete_payment(uuid, int) to authenticated;
