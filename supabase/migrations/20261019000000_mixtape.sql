-- Mixtape's whole backend: one table of library items and four functions. Run it once in a new Supabase
-- project (SQL Editor, or `supabase db push`). See docs/accounts.md.

-- Every synced thing is one row: a liked song, a saved album, a playlist (with its songs), a folder,
-- your pins, your lyrics for a song, your profile. data null is a deletion, kept so other devices learn
-- of it. rev counts up across every write, so a device asks for "everything after rev N". at is when
-- the change was made, on the device that made it: the later change wins a conflict.
create sequence public.items_rev;
create table public.items (
  user_id uuid not null references auth.users on delete cascade,
  kind text not null,
  id text not null,
  data jsonb,
  at bigint not null default 0,
  rev bigint not null,
  primary key (user_id, kind, id)
);
create index items_by_rev on public.items (user_id, rev);

-- You can read your own rows; writes only go through sync().
alter table public.items enable row level security;
create policy "read own" on public.items for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.items from anon, authenticated;
grant select on public.items to authenticated;
revoke all on sequence public.items_rev from anon, authenticated;

-- One round of sync: your changes in, then everything since your last round out (yours included, so
-- your cursor moves past them). A change to something that's changed since you last looked isn't
-- applied: it comes back to you instead, to merge and send again. took has each change's new rev, or
-- null for those. Rounds for one person run one at a time.
create function public.sync(changes jsonb, since bigint) returns jsonb
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

-- Sharing: a playlist you've made public, and your profile with your public playlists. Anyone with the
-- link can read these, signed in or not; nothing else of yours.
create function public.shared_playlist(owner uuid, list text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'playlist', p.data,
    'owner', coalesce((select me.data from public.items me where me.user_id = owner and me.kind = 'profile' and me.id = 'me'), '{}'))
  from public.items p
  where p.user_id = owner and p.kind = 'playlist' and p.id = list and (p.data->>'public')::boolean
$$;
create function public.public_profile(owner uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profile', coalesce((select me.data from public.items me where me.user_id = owner and me.kind = 'profile' and me.id = 'me'), '{}'),
    'playlists', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.data->'name', 'about', p.data->'about', 'cover', p.data->'cover',
        'count', jsonb_array_length(coalesce(p.data->'tracks', '[]')),
        'thumbs', (select coalesce(jsonb_agg(t->'thumb'), '[]') from (select t from jsonb_array_elements(coalesce(p.data->'tracks', '[]')) t limit 4) four)
      ) order by p.at desc)
      from public.items p where p.user_id = owner and p.kind = 'playlist' and (p.data->>'public')::boolean), '[]'))
  where exists (select from auth.users u where u.id = owner)
$$;

-- Deleting your account deletes everything synced with it (items go with the user).
create function public.delete_me() returns void
language sql security definer set search_path = '' as $$
  delete from auth.users where id = auth.uid()
$$;

-- Spelled out, so it works with "Automatically expose new tables" off.
grant usage on schema public to anon, authenticated;
revoke execute on function public.sync(jsonb, bigint), public.delete_me() from public, anon;
grant execute on function public.sync(jsonb, bigint), public.delete_me() to authenticated;
grant execute on function public.shared_playlist(uuid, text), public.public_profile(uuid) to anon, authenticated;
