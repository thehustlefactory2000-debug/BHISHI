alter table public.bhishi_members drop constraint if exists bhishi_members_group_id_phone_key;

alter table public.bhishi_members
  add column if not exists contributors jsonb not null default '[]'::jsonb;

update public.bhishi_members
set contributors = jsonb_build_array(
  jsonb_build_object(
    'id', id::text || '-primary',
    'name', name,
    'phone', phone
  )
)
where contributors = '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bhishi_members_group_id_name_key'
  ) then
    alter table public.bhishi_members
      add constraint bhishi_members_group_id_name_key unique (group_id, name);
  end if;
end $$;

create or replace function public.create_bhishi_group(
  p_name text,
  p_monthly_amount numeric,
  p_total_members integer,
  p_interest_rate numeric,
  p_start_date date,
  p_payout_date smallint,
  p_members jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_admin_id uuid := auth.uid();
  v_member jsonb;
  v_month_id uuid;
  v_month_number integer;
  v_expected_amount numeric;
  v_member_count integer;
  v_contributors jsonb;
  v_primary_phone text;
  v_member_phone text;
begin
  if v_admin_id is null then
    raise exception 'Authentication required';
  end if;

  v_member_count := jsonb_array_length(p_members);

  if p_total_members <> v_member_count then
    raise exception 'Member count must equal total members and total months';
  end if;

  if p_total_members < 2 or p_total_members > 50 then
    raise exception 'Total members must be between 2 and 50';
  end if;

  if exists (
    select 1
    from (
      select lower(trim(item->>'name')) as member_name
      from jsonb_array_elements(p_members) item
    ) names
    group by member_name
    having count(*) > 1
  ) then
    raise exception 'Duplicate member names are not allowed within a group';
  end if;

  insert into public.bhishi_groups (
    admin_id,
    name,
    monthly_amount,
    total_members,
    interest_rate,
    start_date,
    payout_date
  ) values (
    v_admin_id,
    trim(p_name),
    p_monthly_amount,
    p_total_members,
    p_interest_rate,
    p_start_date,
    p_payout_date
  )
  returning id into v_group_id;

  for v_member in select * from jsonb_array_elements(p_members)
  loop
    v_member_phone := trim(coalesce(v_member->>'phone', ''));
    v_contributors := coalesce(v_member->'contributors', '[]'::jsonb);

    if v_member_phone !~ '^[0-9]{10}$' then
      raise exception 'Every member needs a 10-digit phone number';
    end if;

    if jsonb_array_length(v_contributors) = 0 then
      v_contributors := jsonb_build_array(jsonb_build_object(
        'id', coalesce(v_member->>'member_number', 'member') || '-primary',
        'name', trim(v_member->>'name'),
        'phone', v_member_phone
      ));
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_contributors) contributor
      where trim(coalesce(contributor->>'name', '')) = ''
    ) then
      raise exception 'Every contributor needs a name';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_contributors) contributor
      where coalesce(contributor->>'phone', '') !~ '^[0-9]{10}$'
    ) then
      raise exception 'Every contributor phone number must contain exactly 10 digits';
    end if;

    select contributor->>'phone'
    into v_primary_phone
    from jsonb_array_elements(v_contributors) contributor
    limit 1;

    insert into public.bhishi_members (
      group_id,
      admin_id,
      member_number,
      name,
      phone,
      contributors
    ) values (
      v_group_id,
      v_admin_id,
      (v_member->>'member_number')::integer,
      trim(v_member->>'name'),
      v_primary_phone,
      v_contributors
    );
  end loop;

  for v_month_number in 1..p_total_members loop
    v_expected_amount := public.calculate_bhishi_payment(
      p_monthly_amount,
      p_interest_rate,
      p_total_members,
      v_month_number
    );

    insert into public.bhishi_months (
      group_id,
      admin_id,
      month_number,
      expected_amount
    ) values (
      v_group_id,
      v_admin_id,
      v_month_number,
      v_expected_amount
    )
    returning id into v_month_id;

    insert into public.bhishi_payments (
      month_id,
      member_id,
      admin_id,
      paid,
      paid_amount
    )
    select v_month_id, m.id, v_admin_id, false, v_expected_amount
    from public.bhishi_members m
    where m.group_id = v_group_id;
  end loop;

  return v_group_id;
end;
$$;

grant execute on function public.create_bhishi_group(text, numeric, integer, numeric, date, smallint, jsonb) to authenticated;
