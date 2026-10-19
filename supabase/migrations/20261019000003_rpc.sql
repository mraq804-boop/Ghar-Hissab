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
