-- Generic key/value settings table (not tied to a specific listing).
-- Used for: "Lịch trống tất cả các căn" Drive link on the availability calendar page.

create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "app_settings read auth" on public.app_settings;
create policy "app_settings read auth" on public.app_settings
  for select using (auth.uid() is not null);

drop policy if exists "app_settings manager write" on public.app_settings;
create policy "app_settings manager write" on public.app_settings
  for all using (public.is_manager_or_admin()) with check (public.is_manager_or_admin());

insert into public.app_settings (key, value)
values ('availability_calendar_drive_link', null)
on conflict (key) do nothing;
