-- @handles: one per account, unique whatever the case, and public (they're how people find each other).
-- The profile item carries a copy for the app; this table is what keeps two people off the same one.
-- Run after 20261025000000_spotify_and_guard.sql.
create table public.handles (
  user_id uuid primary key references auth.users on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_.]{3,24}$')
);
alter table public.handles enable row level security;
create policy "Anyone can see handles" on public.handles for select using (true);
create policy "Pick your own" on public.handles for insert with check (user_id = auth.uid());
create policy "Change your own" on public.handles for update using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select on public.handles to anon, authenticated;
grant insert, update on public.handles to authenticated;
