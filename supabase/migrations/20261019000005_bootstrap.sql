create or replace function public.bootstrap_household(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  h uuid;
  x jsonb;
  y jsonb;
  rid uuid;
  ids jsonb := '{}'::jsonb;
  units jsonb := '{}'::jsonb;
  sections jsonb := '{}'::jsonb;
  rules jsonb := '{}'::jsonb;
  cats jsonb := '{}'::jsonb;
  new_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  insert into public.households (name) values (p ->> 'name') returning id into h;
  insert into public.app_settings (household_id) values (h);
  insert into public.sync_leases (household_id) values (h);

  for x in select * from jsonb_array_elements(p -> 'units') loop
    insert into public.units (household_id, code, name, sort_order, is_purse_holder)
    values (h, x ->> 'code', x ->> 'name', (x ->> 'sortOrder')::int, coalesce((x ->> 'isPurseHolder')::boolean, false))
    returning id into new_id;
    units := units || jsonb_build_object(x ->> 'code', new_id);
  end loop;

  for x in select * from jsonb_array_elements(p -> 'sections') loop
    insert into public.expense_sections (household_id, key, title, sort_order)
    values (h, x ->> 'key', x ->> 'title', (x ->> 'sortOrder')::int)
    returning id into new_id;
    sections := sections || jsonb_build_object(x ->> 'key', new_id);
  end loop;

  for x in select * from jsonb_array_elements(p -> 'rules') loop
    insert into public.split_rules (household_id, name, code, type, description, is_system)
    values (h, x ->> 'name', x ->> 'key', (x ->> 'type')::public.split_type, x ->> 'description', coalesce((x ->> 'isSystem')::boolean, true))
    returning id into rid;
    for y in select * from jsonb_array_elements(coalesce(x -> 'parts', '[]'::jsonb)) loop
      insert into public.split_rule_parts (rule_id, unit_id, num, den, percent)
      values (rid, (units ->> (y ->> 'unit'))::uuid, (y ->> 'num')::int, (y ->> 'den')::int, (y ->> 'percent')::numeric);
    end loop;
    rules := rules || jsonb_build_object(x ->> 'key', rid);
  end loop;

  for x in select * from jsonb_array_elements(p -> 'categories') loop
    insert into public.expense_categories (household_id, name, section_id, default_split_rule_id, icon, sort_order)
    values (h, x ->> 'name', (sections ->> (x ->> 'section'))::uuid, (rules ->> (x ->> 'rule'))::uuid, x ->> 'icon', (x ->> 'sortOrder')::int)
    returning id into new_id;
    cats := cats || jsonb_build_object(x ->> 'key', new_id);
  end loop;

  return jsonb_build_object('householdId', h, 'units', units, 'sections', sections, 'rules', rules, 'categories', cats);
end $$;

revoke execute on function public.bootstrap_household(jsonb) from public, anon, authenticated;
