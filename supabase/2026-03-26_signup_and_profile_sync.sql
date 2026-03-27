create or replace function public.sync_admin_profile_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
  set email = excluded.email,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
after update of email on auth.users
for each row execute function public.sync_admin_profile_from_auth();

create or replace function public.ensure_current_admin_profile()
returns public.admin_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_email text;
  v_profile public.admin_profiles;
begin
  if v_admin_id is null then
    raise exception 'Authentication required';
  end if;

  select email into v_email
  from auth.users
  where id = v_admin_id;

  insert into public.admin_profiles (id, email)
  values (v_admin_id, v_email)
  on conflict (id) do update
  set email = excluded.email,
      updated_at = now();

  select * into v_profile
  from public.admin_profiles
  where id = v_admin_id;

  return v_profile;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'admin_profiles'
      and policyname = 'admin_profiles_insert_own'
  ) then
    create policy "admin_profiles_insert_own"
    on public.admin_profiles
    for insert
    with check (id = auth.uid());
  end if;
end;
$$;

grant execute on function public.ensure_current_admin_profile() to authenticated;
