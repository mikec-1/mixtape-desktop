-- What Sleeve takes from Mixtape's backend: the guard against a device wiping your library, and Spotify
-- following your account, with the server bringing your Spotify plays into History every half hour.
-- Run after 20261019000000_sleeve.sql. The cron job at the end calls the spotify_history function, so
-- deploy that too. See docs/accounts.md.

-- sync() as before, plus bulk: the app sets it when you removed lots on purpose.
drop function public.sync(jsonb, bigint);
create function public.sync(changes jsonb, since bigint, bulk boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  c jsonb;
  r bigint;
  took jsonb := '[]';
  rows jsonb;
  top bigint;
  more boolean;
begin
  if uid is null then raise exception 'Sign in to sync' using errcode = '28000'; end if;
  -- Deleted on another device: that device's sign-in still holds until it runs out, so say so.
  if not exists (select from auth.users where id = uid) then raise exception 'This account was deleted' using errcode = 'SV001'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  -- Mixtape's guard: more than 50 things removed at once, unless the app says you did it, is a library that
  -- went missing on a device. Refused, so it can't wipe every other device; the app reads it all back.
  if not bulk and (select count(*) from jsonb_array_elements(coalesce(changes, '[]')) x
                   join public.items i on i.user_id = uid and i.kind = x.value->>'kind' and i.id = x.value->>'id'
                   where nullif(x.value->'data', 'null'::jsonb) is null and i.data is not null) > 50 then
    raise exception 'Too many removed at once' using errcode = 'SV002';
  end if;
  for c in select value from jsonb_array_elements(coalesce(changes, '[]')) loop
    r := null;
    insert into public.items as i (user_id, kind, id, data, at, rev)
    values (uid, c->>'kind', c->>'id', nullif(c->'data', 'null'::jsonb), coalesce((c->>'at')::bigint, 0), nextval('public.items_rev'))
    on conflict (user_id, kind, id) do update set data = excluded.data, at = excluded.at, rev = excluded.rev where i.rev <= since
    returning i.rev into r;
    took := took || coalesce(to_jsonb(r), 'null');
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'data', data, 'at', at, 'rev', rev) order by rev), '[]'), max(rev), count(*) = 1000
    into rows, top, more
    from (select * from public.items where user_id = uid and rev > since order by rev limit 1000) page;
  return jsonb_build_object('items', rows, 'cursor', coalesce(top, since), 'more', more, 'took', took);
end $$;
revoke execute on function public.sync(jsonb, bigint, boolean) from public, anon;
grant execute on function public.sync(jsonb, bigint, boolean) to authenticated;

-- Your Spotify sign-in, kept with your account so every device (and the server) can use it. One row each:
-- whoever refreshed last holds the live token, as Spotify may hand out a new one each time. Deleting it
-- disconnects every device.
create table public.spotify_connections (
  user_id uuid primary key references auth.users on delete cascade,
  refresh_token text not null,
  scope text,
  history_sync boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.spotify_connections enable row level security;
create policy "own" on public.spotify_connections for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.spotify_connections to authenticated;

-- Songs you played on Spotify, copied from its recently played list by spotify_history. track is
-- Spotify's own song object, which the app turns into a song the way it does at import. Only the job
-- writes them.
create table public.spotify_plays (
  user_id uuid not null references auth.users on delete cascade,
  played_at timestamptz not null,
  track jsonb not null,
  primary key (user_id, played_at)
);
alter table public.spotify_plays enable row level security;
create policy "read own" on public.spotify_plays for select to authenticated using (user_id = (select auth.uid()));
create policy "delete own" on public.spotify_plays for delete to authenticated using (user_id = (select auth.uid()));
grant select, delete on public.spotify_plays to authenticated;
grant select, insert, update, delete on public.spotify_plays, public.spotify_connections to service_role;

-- The secret the cron job signs its calls with, made here so it's never copied anywhere; the function
-- reads it back with the service role.
do $$ begin
  if not exists (select from vault.secrets where name = 'job_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'job_secret');
  end if;
end $$;
create function public.job_secret() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'job_secret'
$$;
revoke all on function public.job_secret() from public, anon, authenticated;
grant execute on function public.job_secret() to service_role;

-- Spotify only keeps your last 50 plays, so every half hour is often enough. The URL is this project's.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.unschedule('spotify-history') where exists (select from cron.job where jobname = 'spotify-history');
select cron.schedule('spotify-history', '*/30 * * * *', $$
  select net.http_post(
    url := 'https://iwuvqbpxtwuduonhlffd.supabase.co/functions/v1/spotify_history',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-job-secret', public.job_secret()),
    timeout_milliseconds := 60000
  );
$$);
