alter table public.households add column import_fingerprint text unique;

create or replace function public.import_workbook(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  boot jsonb;
  h uuid;
  pid uuid;
  x jsonb;
  mid uuid;
  labels jsonb := '{}'::jsonb;
  admin_member uuid;
  purse uuid;
  pay_id uuid;
  i int := 0;
  lbl text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if exists (select 1 from public.households where import_fingerprint = p ->> 'fingerprint') then
    raise exception 'already_imported' using hint = 'This workbook has already been imported.';
  end if;

  boot := public.bootstrap_household(p -> 'bootstrap');
  h := (boot ->> 'householdId')::uuid;
  update public.households set import_fingerprint = p ->> 'fingerprint' where id = h;
  purse := (boot -> 'units' ->> (p ->> 'purseHolder'))::uuid;

  for x in select * from jsonb_array_elements(p -> 'members') loop
    insert into public.members (household_id, unit_id, full_name, email, relation, duty_label, joined_on)
    values (h, (boot -> 'units' ->> (x ->> 'unit'))::uuid, x ->> 'fullName', nullif(x ->> 'email', ''), nullif(x ->> 'relation', ''),
            nullif(x ->> 'dutyLabel', ''), coalesce(nullif(x ->> 'joinedOn', '')::date, current_date))
    returning id into mid;
    if nullif(x ->> 'dutyLabel', '') is not null then
      labels := labels || jsonb_build_object(x ->> 'dutyLabel', mid);
    end if;
    if coalesce((x ->> 'admin')::boolean, false) then
      admin_member := mid;
      insert into public.household_invites (household_id, member_id, email, role)
      values (h, mid, lower(x ->> 'email'), 'admin');
    end if;
  end loop;
  if admin_member is null then
    raise exception 'invalid_import' using hint = 'Mark one member as the administrator.';
  end if;

  insert into public.periods (household_id, year, month, sheet_name)
  values (h, (p -> 'period' ->> 'year')::int, (p -> 'period' ->> 'month')::int, p -> 'period' ->> 'sheetName')
  returning id into pid;

  for x in select * from jsonb_array_elements(p -> 'expenses') loop
    i := i + 1;
    insert into public.expenses (
      household_id, period_id, section_id, category_id, title, qty_text, qty_num, rate, amount, split_rule_id,
      paid_by_unit_id, notes, sort_order, source
    ) values (
      h, pid, (boot -> 'sections' ->> (x ->> 'section'))::uuid, (boot -> 'categories' ->> (x ->> 'category'))::uuid,
      x ->> 'title', nullif(x ->> 'qtyText', ''), nullif(x ->> 'qtyNum', '')::numeric, nullif(x ->> 'rate', '')::numeric,
      nullif(x ->> 'amount', '')::numeric, (boot -> 'rules' ->> (x ->> 'rule'))::uuid, purse, nullif(x ->> 'notes', ''), i, 'import'
    );
  end loop;

  for x in select * from jsonb_array_elements(p -> 'payments') loop
    insert into public.payments (
      household_id, period_id, payer_unit_id, recipient_unit_id, amount, paid_on, method, notes, status, source, idempotency_key
    ) values (
      h, pid, (boot -> 'units' ->> (x ->> 'unit'))::uuid, purse, (x ->> 'amount')::numeric, (x ->> 'paidOn')::date, 'other',
      'Imported from the workbook''s Paid column', 'approved', 'import', gen_random_uuid()
    ) returning id into pay_id;
    insert into public.payment_reviews (payment_id, decision, reason)
    values (pay_id, 'approved', 'Imported from the workbook');
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p -> 'menu', '[]')) loop
    insert into public.meal_slots (household_id, week, weekday, fixed_category, dish)
    values (h, (x ->> 'week')::int, (x ->> 'weekday')::int, coalesce(x ->> 'fixedCategory', ''), coalesce(x ->> 'dish', ''));
  end loop;
  i := 0;
  for x in select * from jsonb_array_elements(coalesce(p -> 'sabzi', '[]')) loop
    i := i + 1;
    insert into public.sabzi_options (household_id, name, sort_order) values (h, x #>> '{}', i) on conflict do nothing;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p -> 'duties', '[]')) loop
    foreach lbl in array array[x ->> 'breakfast', x ->> 'lunch', x ->> 'dinner', x ->> 'off'] loop
      if lbl is not null and lbl <> '' and not labels ? lbl then
        raise exception 'invalid_import' using hint = format('Kitchen duty label %s is not assigned to any member.', lbl);
      end if;
    end loop;
    insert into public.duty_days (household_id, day, breakfast_member_id, lunch_member_id, dinner_member_id, off_member_id, off_note)
    values (h, (x ->> 'day')::date, (labels ->> (x ->> 'breakfast'))::uuid, (labels ->> (x ->> 'lunch'))::uuid,
            (labels ->> (x ->> 'dinner'))::uuid, (labels ->> (x ->> 'off'))::uuid, nullif(x ->> 'offNote', ''));
  end loop;

  i := 0;
  for x in select * from jsonb_array_elements(coalesce(p -> 'dutyNotes', '[]')) loop
    i := i + 1;
    insert into public.kitchen_notes (household_id, scope, sort_order, body) values (h, 'duties:' || (p ->> 'dutyMonth'), i, x #>> '{}');
  end loop;

  insert into public.excel_sheets (household_id, scope, worksheet_name) values
    (h, 'period:' || pid, p -> 'period' ->> 'sheetName'),
    (h, 'menu', 'Weekly Food Schedule');
  if p ->> 'dutyMonth' is not null then
    insert into public.excel_sheets (household_id, scope, worksheet_name) values (h, 'duties:' || (p ->> 'dutyMonth'), 'Kitchen Duties');
  end if;

  perform public.link_existing_user(lower(x2.email)) from public.household_invites x2 where x2.household_id = h;
  return h;
end $$;

revoke execute on function public.import_workbook(jsonb) from public, anon, authenticated;
