do $$
declare t text;
begin
  foreach t in array array[
    'households', 'units', 'members', 'household_roles', 'household_invites', 'periods', 'expense_sections',
    'split_rules', 'split_rule_parts', 'expense_categories', 'expenses', 'payments', 'payment_attachments',
    'payment_reviews', 'meal_slots', 'sabzi_options', 'kitchen_notes', 'duty_days', 'app_settings',
    'excel_connection', 'excel_sheets', 'sync_jobs', 'sync_scope_state', 'sync_runs', 'sync_leases', 'audit_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- read access for every household member
create policy households_read on public.households for select to authenticated using (public.is_member(id));
create policy units_read on public.units for select to authenticated using (public.is_member(household_id));
create policy periods_read on public.periods for select to authenticated using (public.is_member(household_id));
create policy sections_read on public.expense_sections for select to authenticated using (public.is_member(household_id));
create policy rules_read on public.split_rules for select to authenticated using (public.is_member(household_id));
create policy rule_parts_read on public.split_rule_parts for select to authenticated
  using (exists (select 1 from public.split_rules r where r.id = rule_id and public.is_member(r.household_id)));
create policy categories_read on public.expense_categories for select to authenticated using (public.is_member(household_id));
create policy meal_slots_read on public.meal_slots for select to authenticated using (public.is_member(household_id));
create policy sabzi_read on public.sabzi_options for select to authenticated using (public.is_member(household_id));
create policy kitchen_notes_read on public.kitchen_notes for select to authenticated using (public.is_member(household_id));
create policy duty_days_read on public.duty_days for select to authenticated using (public.is_member(household_id));
create policy settings_read on public.app_settings for select to authenticated using (public.is_member(household_id));
create policy members_read on public.members for select to authenticated using (public.is_member(household_id));
create policy roles_read on public.household_roles for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin(household_id));

-- admin-managed configuration (financial rows go through RPCs)
create policy units_admin_write on public.units for all to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));
create policy members_admin_write on public.members for all to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));
create policy roles_admin_write on public.household_roles for all to authenticated
  using (public.is_admin(household_id) and user_id <> (select auth.uid()))
  with check (public.is_admin(household_id) and user_id <> (select auth.uid()));
create policy invites_admin on public.household_invites for all to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));
create policy rules_admin_write on public.split_rules for all to authenticated
  using (public.is_admin(household_id) and not is_system) with check (public.is_admin(household_id) and not is_system);
create policy rule_parts_admin_write on public.split_rule_parts for all to authenticated
  using (exists (select 1 from public.split_rules r where r.id = rule_id and public.is_admin(r.household_id) and not r.is_system))
  with check (exists (select 1 from public.split_rules r where r.id = rule_id and public.is_admin(r.household_id) and not r.is_system));
create policy categories_admin_write on public.expense_categories for all to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));
create policy meal_slots_admin_write on public.meal_slots for all to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));
create policy sabzi_admin_write on public.sabzi_options for all to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));
create policy kitchen_notes_admin_write on public.kitchen_notes for all to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));
create policy duty_days_admin_write on public.duty_days for all to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));
create policy settings_admin_write on public.app_settings for update to authenticated
  using (public.is_admin(household_id)) with check (public.is_admin(household_id));

-- expenses: admins always, members when the household allows it
create policy expenses_read on public.expenses for select to authenticated
  using (public.is_admin(household_id)
         or (public.is_member(household_id) and public.setting_enabled(household_id, 'members_see_all_expenses')));

-- payments: admins, the payer unit, or everyone when balances are shared (screenshots stay private, see storage)
create policy payments_read on public.payments for select to authenticated
  using (public.is_admin(household_id)
         or payer_unit_id = public.my_unit(household_id)
         or (public.is_member(household_id) and public.setting_enabled(household_id, 'members_see_all_balances')));
create policy attachments_read on public.payment_attachments for select to authenticated
  using (exists (
    select 1 from public.payments p where p.id = payment_id
      and (public.is_admin(p.household_id) or p.payer_unit_id = public.my_unit(p.household_id))));
create policy reviews_read on public.payment_reviews for select to authenticated
  using (exists (
    select 1 from public.payments p where p.id = payment_id
      and (public.is_admin(p.household_id) or p.payer_unit_id = public.my_unit(p.household_id))));

-- sync + audit: admins read, only the service role writes
create policy excel_sheets_admin_read on public.excel_sheets for select to authenticated using (public.is_admin(household_id));
create policy sync_jobs_admin_read on public.sync_jobs for select to authenticated using (public.is_admin(household_id));
create policy sync_state_member_read on public.sync_scope_state for select to authenticated using (public.is_member(household_id));
create policy sync_runs_admin_read on public.sync_runs for select to authenticated using (public.is_admin(household_id));
create policy audit_admin_read on public.audit_log for select to authenticated using (public.is_admin(household_id));

create view public.excel_connection_public with (security_invoker = true) as
  select household_id, account_email, drive_id, item_id, file_name, web_url, token_updated_at, connected_at,
         token_updated_at is not null as has_token
  from public.excel_connection;
create policy excel_connection_admin_read on public.excel_connection for select to authenticated using (public.is_admin(household_id));
revoke select on public.excel_connection from authenticated, anon;
grant select (household_id, account_email, drive_id, item_id, file_name, web_url, token_updated_at, connected_at)
  on public.excel_connection to authenticated;
grant select on public.excel_connection_public to authenticated;

-- private storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('payment-proofs', 'payment-proofs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']),
  ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy proofs_insert_own on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and public.is_member(public.try_uuid((storage.foldername(name))[1]))
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

create policy proofs_read on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (
      public.is_admin(public.try_uuid((storage.foldername(name))[1]))
      or (storage.foldername(name))[2] = (select auth.uid())::text
      or exists (
        select 1 from public.payment_attachments a join public.payments p on p.id = a.payment_id
        where a.storage_path = name and p.payer_unit_id = public.my_unit(p.household_id)
      )
    )
  );

create policy receipts_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_admin(public.try_uuid((storage.foldername(name))[1])));

create policy receipts_read on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and (
      public.is_admin(public.try_uuid((storage.foldername(name))[1]))
      or (public.is_member(public.try_uuid((storage.foldername(name))[1]))
          and public.setting_enabled(public.try_uuid((storage.foldername(name))[1]), 'members_see_all_expenses'))
    )
  );
