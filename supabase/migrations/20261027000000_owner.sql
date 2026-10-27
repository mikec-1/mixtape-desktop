-- Who gets the developer tools. Nobody can write here from the app (no policies); add yourself in the SQL editor:
-- insert into public.owners select id from auth.users where email = 'you@example.com';
create table public.owners (user_id uuid primary key references auth.users on delete cascade);
alter table public.owners enable row level security;

create function public.am_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.owners where user_id = (select auth.uid()));
$$;
revoke execute on function public.am_owner() from public, anon;
grant execute on function public.am_owner() to authenticated;
