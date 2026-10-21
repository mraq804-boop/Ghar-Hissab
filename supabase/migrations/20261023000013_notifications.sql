-- Push notifications, the in-app notification list, per-person preferences and reminders.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  user_agent text check (user_agent is null or length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  failures integer not null default 0
);
alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_member(household_id));

create table public.notification_prefs (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  quiet_start time not null default '22:00',
  quiet_end time not null default '08:00',
  payments boolean not null default true,
  bills boolean not null default true,
  meters boolean not null default true,
  money boolean not null default true,
  summary boolean not null default true,
  reminders boolean not null default true,
  personal boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
create policy notification_prefs_own on public.notification_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('payments', 'bills', 'meters', 'money', 'summary', 'reminders', 'personal', 'test')),
  title text not null check (length(title) <= 120),
  body text check (body is null or length(body) <= 300),
  url text check (url is null or url ~ '^/'),
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  deliver_after timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz,
  unique (user_id, dedupe_key)
);
create index notifications_user_recent on public.notifications (user_id, created_at desc);
create index notifications_undelivered on public.notifications (deliver_after) where sent_at is null;
alter table public.notifications enable row level security;
create policy notifications_own_read on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_own_mark on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  audience text not null default 'me' check (audience in ('me', 'family')),
  title text not null check (length(btrim(title)) between 1 and 80),
  note text check (note is null or length(note) <= 200),
  next_at timestamptz not null,
  repeat text not null default 'none' check (repeat in ('none', 'daily', 'weekly', 'monthly')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index reminders_due on public.reminders (next_at) where active;
alter table public.reminders enable row level security;
create policy reminders_read on public.reminders for select to authenticated
  using (created_by = (select auth.uid()) or (audience = 'family' and public.is_member(household_id)));
create policy reminders_add on public.reminders for insert to authenticated
  with check (created_by = (select auth.uid()) and public.is_member(household_id));
create policy reminders_change on public.reminders for update to authenticated
  using (created_by = (select auth.uid()) or (audience = 'family' and public.is_admin(household_id)))
  with check (created_by = (select auth.uid()) or (audience = 'family' and public.is_admin(household_id)));
create policy reminders_remove on public.reminders for delete to authenticated
  using (created_by = (select auth.uid()) or (audience = 'family' and public.is_admin(household_id)));
