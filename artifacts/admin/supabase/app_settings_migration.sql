-- Generic key/value settings table (not tied to a specific listing).
-- Used for: "Lịch trống tất cả các căn" Drive link on the availability calendar page.

create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Readable by everyone, including logged-out guests (matches how listings are public).
drop policy if exists "app_settings read auth" on public.app_settings;
drop policy if exists "app_settings read public" on public.app_settings;
create policy "app_settings read public" on public.app_settings
  for select using (true);

-- Writable by any logged-in admin user (this project has no separate manager/admin role check).
drop policy if exists "app_settings manager write" on public.app_settings;
create policy "app_settings manager write" on public.app_settings
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

insert into public.app_settings (key, value)
values ('availability_calendar_drive_link', null)
on conflict (key) do nothing;
