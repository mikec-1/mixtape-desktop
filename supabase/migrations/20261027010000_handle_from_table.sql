-- A profile's @handle comes from public.handles (which keeps them unique), never from the copy in the
-- profile item, so a stale or edited copy can't show someone else's handle.
create or replace function public.public_profile(owner uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profile', (coalesce((select me.data from public.items me where me.user_id = owner and me.kind = 'profile' and me.id = 'me'), '{}') - 'handle')
      || coalesce((select jsonb_build_object('handle', h.handle) from public.handles h where h.user_id = owner), '{}'),
    'playlists', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.data->'name', 'about', p.data->'about', 'cover', p.data->'cover',
        'count', jsonb_array_length(coalesce(p.data->'tracks', '[]')),
        'thumbs', (select coalesce(jsonb_agg(t->'thumb'), '[]') from (select t from jsonb_array_elements(coalesce(p.data->'tracks', '[]')) t limit 4) four)
      ) order by p.at desc)
      from public.items p where p.user_id = owner and p.kind = 'playlist' and (p.data->>'public')::boolean), '[]'))
  where exists (select from auth.users u where u.id = owner)
$$;
