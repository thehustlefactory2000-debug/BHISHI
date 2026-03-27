create extension if not exists pgcrypto;

create type public.payment_mode as enum ('online', 'offline');
create type public.theme_mode as enum ('light', 'dark', 'system');
create type public.language_code as enum ('en', 'mr', 'hi');

create table if not exists public.admin_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  preferred_language public.language_code not null default 'en',
  preferred_theme public.theme_mode not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bhishi_groups (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 50),
  monthly_amount numeric(12, 2) not null check (monthly_amount > 0),
  total_members integer not null check (total_members between 2 and 50),
  interest_rate numeric(6, 4) not null check (interest_rate between 0 and 0.10),
  start_date date not null,
  payout_date smallint not null check (payout_date between 1 and 28),
  is_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bhishi_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.bhishi_groups(id) on delete cascade,
  admin_id uuid not null references auth.users(id) on delete cascade,
  member_number integer not null check (member_number > 0),
  name text not null check (char_length(name) between 1 and 100),
  phone text not null check (phone ~ '^[0-9]{10}$'),
  contributors jsonb not null default '[]'::jsonb,
  has_won boolean not null default false,
  payout_month integer,
  created_at timestamptz not null default now(),
  unique (group_id, member_number)
);

create table if not exists public.bhishi_months (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.bhishi_groups(id) on delete cascade,
  admin_id uuid not null references auth.users(id) on delete cascade,
  month_number integer not null check (month_number > 0),
  expected_amount numeric(12, 2) not null check (expected_amount > 0),
  winner_member_id uuid references public.bhishi_members(id) on delete set null,
  is_locked boolean not null default false,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (group_id, month_number)
);

create table if not exists public.bhishi_payments (
  id uuid primary key default gen_random_uuid(),
  month_id uuid not null references public.bhishi_months(id) on delete cascade,
  member_id uuid not null references public.bhishi_members(id) on delete cascade,
  admin_id uuid not null references auth.users(id) on delete cascade,
  paid boolean not null default false,
  paid_date date,
  payment_mode public.payment_mode,
  paid_amount numeric(12, 2),
  sub_payments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (month_id, member_id),
  check (paid_amount is null or paid_amount >= 0)
);

create unique index if not exists idx_bhishi_members_group_name_unique on public.bhishi_members(group_id, lower(name));
create index if not exists idx_bhishi_groups_admin_created on public.bhishi_groups(admin_id, created_at desc);
create index if not exists idx_bhishi_members_group on public.bhishi_members(group_id, member_number);
create index if not exists idx_bhishi_members_admin_group on public.bhishi_members(admin_id, group_id);
create index if not exists idx_bhishi_months_group on public.bhishi_months(group_id, month_number);
create index if not exists idx_bhishi_months_admin_group on public.bhishi_months(admin_id, group_id, month_number);
create index if not exists idx_bhishi_payments_month_member on public.bhishi_payments(month_id, member_id);
create index if not exists idx_bhishi_payments_admin_month on public.bhishi_payments(admin_id, month_id);
create index if not exists idx_bhishi_payments_unpaid on public.bhishi_payments(month_id) where paid = false;

alter table public.bhishi_groups replica identity full;
alter table public.bhishi_members replica identity full;
alter table public.bhishi_months replica identity full;
alter table public.bhishi_payments replica identity full;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.calculate_bhishi_payment(
  p_base_amount numeric,
  p_interest_rate numeric,
  p_total_members integer,
  p_month_number integer
)
returns numeric
language sql
immutable
as $$
  select case
    when p_month_number = 1 or p_month_number = p_total_members then round(p_base_amount, 2)
    else round(p_base_amount * (1 - p_interest_rate * (p_total_members - p_month_number)), 2)
  end;
$$;

create or replace function public.can_manage_month(
  p_group_id uuid,
  p_month_number integer
)
returns boolean
language sql
stable
as $$
  select true;
$$;

create or replace function public.split_bhishi_contributor_payments(
  p_expected_amount numeric,
  p_contributors jsonb,
  p_paid boolean default false,
  p_paid_date date default null,
  p_payment_mode public.payment_mode default null
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_total_cents integer := round(coalesce(p_expected_amount, 0) * 100);
  v_count integer := greatest(jsonb_array_length(coalesce(p_contributors, '[]'::jsonb)), 1);
  v_base integer := floor(v_total_cents / v_count);
  v_remainder integer := mod(v_total_cents, v_count);
  v_result jsonb := '[]'::jsonb;
  v_item jsonb;
  v_index integer := 0;
  v_amount numeric;
  v_contributor_id text;
begin
  for v_item in select value from jsonb_array_elements(coalesce(p_contributors, '[]'::jsonb))
  loop
    v_amount := (v_base + case when v_index < v_remainder then 1 else 0 end)::numeric / 100;
    v_contributor_id := coalesce(v_item->>'id', format('contributor-%s', v_index + 1));
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'contributor_id', v_contributor_id,
      'paid', p_paid,
      'paid_date', case when p_paid then coalesce(p_paid_date, current_date) else null end,
      'payment_mode', case when p_paid then coalesce(p_payment_mode, 'offline') else null end,
      'paid_amount', v_amount
    ));
    v_index := v_index + 1;
  end loop;

  return v_result;
end;
$$;

create or replace function public.rebalance_bhishi_sub_payments(
  p_existing_sub_payments jsonb,
  p_contributors jsonb,
  p_expected_amount numeric
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_total_cents integer := round(coalesce(p_expected_amount, 0) * 100);
  v_count integer := greatest(jsonb_array_length(coalesce(p_contributors, '[]'::jsonb)), 1);
  v_base integer := floor(v_total_cents / v_count);
  v_remainder integer := mod(v_total_cents, v_count);
  v_result jsonb := '[]'::jsonb;
  v_item jsonb;
  v_existing jsonb;
  v_index integer := 0;
  v_amount numeric;
  v_contributor_id text;
  v_paid boolean;
  v_paid_date text;
  v_payment_mode text;
begin
  for v_item in select value from jsonb_array_elements(coalesce(p_contributors, '[]'::jsonb))
  loop
    v_amount := (v_base + case when v_index < v_remainder then 1 else 0 end)::numeric / 100;
    v_contributor_id := coalesce(v_item->>'id', format('contributor-%s', v_index + 1));

    select value
    into v_existing
    from jsonb_array_elements(coalesce(p_existing_sub_payments, '[]'::jsonb))
    where value->>'contributor_id' = v_contributor_id
    limit 1;

    v_paid := coalesce((v_existing->>'paid')::boolean, false);
    v_paid_date := case when v_paid then v_existing->>'paid_date' else null end;
    v_payment_mode := case when v_paid then v_existing->>'payment_mode' else null end;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'contributor_id', v_contributor_id,
      'paid', v_paid,
      'paid_date', v_paid_date,
      'payment_mode', v_payment_mode,
      'paid_amount', v_amount
    ));
    v_index := v_index + 1;
  end loop;

  return v_result;
end;
$$;

create or replace function public.refresh_group_completion(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bhishi_groups g
  set is_completed = not exists (
        select 1
        from public.bhishi_months m
        where m.group_id = p_group_id
          and m.winner_member_id is null
      ),
      updated_at = now()
  where g.id = p_group_id;
end;
$$;

create or replace function public.refresh_bhishi_member_wins(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bhishi_members m
  set has_won = exists (
        select 1
        from public.bhishi_months months
        where months.group_id = p_group_id
          and months.winner_member_id = m.id
      ),
      payout_month = (
        select min(months.month_number)
        from public.bhishi_months months
        where months.group_id = p_group_id
          and months.winner_member_id = m.id
      )
  where m.group_id = p_group_id;

  perform public.refresh_group_completion(p_group_id);
end;
$$;

create or replace function public.handle_new_admin_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_admin_profile();

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
      expected_amount,
      is_locked,
      locked_at
    ) values (
      v_group_id,
      v_admin_id,
      v_month_number,
      v_expected_amount,
      false,
      null
    )
    returning id into v_month_id;

    insert into public.bhishi_payments (
      month_id,
      member_id,
      admin_id,
      paid,
      paid_amount,
      sub_payments
    )
    select
      v_month_id,
      m.id,
      v_admin_id,
      false,
      0,
      public.split_bhishi_contributor_payments(v_expected_amount, m.contributors, false, null, null)
    from public.bhishi_members m
    where m.group_id = v_group_id;
  end loop;

  return v_group_id;
end;
$$;

create or replace function public.update_bhishi_group(
  p_group_id uuid,
  p_name text default null,
  p_monthly_amount numeric default null,
  p_interest_rate numeric default null,
  p_start_date date default null,
  p_payout_date smallint default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_group public.bhishi_groups;
  v_month record;
  v_next_monthly_amount numeric;
  v_next_interest_rate numeric;
  v_financials_changed boolean := false;
  v_expected_amount numeric;
begin
  if v_admin_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_group
  from public.bhishi_groups
  where id = p_group_id
    and admin_id = v_admin_id;

  if v_group.id is null then
    raise exception 'Group not found';
  end if;

  v_next_monthly_amount := coalesce(p_monthly_amount, v_group.monthly_amount);
  v_next_interest_rate := coalesce(p_interest_rate, v_group.interest_rate);
  v_financials_changed := v_next_monthly_amount <> v_group.monthly_amount
    or v_next_interest_rate <> v_group.interest_rate;

  update public.bhishi_groups
  set name = coalesce(nullif(trim(p_name), ''), name),
      monthly_amount = v_next_monthly_amount,
      interest_rate = v_next_interest_rate,
      start_date = coalesce(p_start_date, start_date),
      payout_date = coalesce(p_payout_date, payout_date),
      updated_at = now()
  where id = p_group_id
    and admin_id = v_admin_id;

  if v_financials_changed then
    for v_month in
      select id, month_number
      from public.bhishi_months
      where group_id = p_group_id
    loop
      v_expected_amount := public.calculate_bhishi_payment(
        v_next_monthly_amount,
        v_next_interest_rate,
        v_group.total_members,
        v_month.month_number
      );

      update public.bhishi_months
      set expected_amount = v_expected_amount,
          is_locked = false,
          locked_at = null
      where id = v_month.id;

      update public.bhishi_payments p
      set sub_payments = public.rebalance_bhishi_sub_payments(p.sub_payments, m.contributors, v_expected_amount),
          paid_amount = coalesce((
            select sum(case when (entry->>'paid')::boolean then coalesce((entry->>'paid_amount')::numeric, 0) else 0 end)
            from jsonb_array_elements(public.rebalance_bhishi_sub_payments(p.sub_payments, m.contributors, v_expected_amount)) entry
          ), 0),
          paid = not exists (
            select 1
            from jsonb_array_elements(public.rebalance_bhishi_sub_payments(p.sub_payments, m.contributors, v_expected_amount)) entry
            where coalesce((entry->>'paid')::boolean, false) = false
          ),
          paid_date = case
            when not exists (
              select 1
              from jsonb_array_elements(public.rebalance_bhishi_sub_payments(p.sub_payments, m.contributors, v_expected_amount)) entry
              where coalesce((entry->>'paid')::boolean, false) = false
            ) then p.paid_date
            else null
          end,
          payment_mode = case
            when not exists (
              select 1
              from jsonb_array_elements(public.rebalance_bhishi_sub_payments(p.sub_payments, m.contributors, v_expected_amount)) entry
              where coalesce((entry->>'paid')::boolean, false) = false
            ) then p.payment_mode
            else null
          end,
          updated_at = now()
      from public.bhishi_members m
      where p.month_id = v_month.id
        and p.member_id = m.id;
    end loop;
  end if;

  perform public.refresh_group_completion(p_group_id);
  return p_group_id;
end;
$$;

create or replace function public.record_bhishi_payment(
  p_group_id uuid,
  p_month_number integer,
  p_member_id uuid,
  p_contributor_id text,
  p_paid boolean,
  p_paid_date date default current_date,
  p_payment_mode public.payment_mode default 'offline',
  p_paid_amount numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_month record;
  v_payment record;
  v_sub_payment jsonb;
  v_next_sub_payments jsonb := '[]'::jsonb;
  v_amount numeric := 0;
  v_all_paid boolean := true;
  v_collected numeric := 0;
  v_found boolean := false;
begin
  if v_admin_id is null then
    raise exception 'Authentication required';
  end if;

  select m.id, m.expected_amount
  into v_month
  from public.bhishi_months m
  where m.group_id = p_group_id
    and m.month_number = p_month_number
    and m.admin_id = v_admin_id;

  if v_month.id is null then
    raise exception 'Month not found';
  end if;

  select p.*
  into v_payment
  from public.bhishi_payments p
  where p.month_id = v_month.id
    and p.member_id = p_member_id
    and p.admin_id = v_admin_id;

  if v_payment.id is null then
    raise exception 'Payment row not found';
  end if;

  for v_sub_payment in select value from jsonb_array_elements(coalesce(v_payment.sub_payments, '[]'::jsonb))
  loop
    if v_sub_payment->>'contributor_id' = p_contributor_id then
      v_amount := coalesce(p_paid_amount, (v_sub_payment->>'paid_amount')::numeric, 0);
      v_sub_payment := jsonb_build_object(
        'contributor_id', p_contributor_id,
        'paid', p_paid,
        'paid_date', case when p_paid then coalesce(p_paid_date, current_date) else null end,
        'payment_mode', case when p_paid then coalesce(p_payment_mode, 'offline') else null end,
        'paid_amount', v_amount
      );
      v_found := true;
    end if;

    v_next_sub_payments := v_next_sub_payments || jsonb_build_array(v_sub_payment);

    if (v_sub_payment->>'paid')::boolean then
      v_collected := v_collected + coalesce((v_sub_payment->>'paid_amount')::numeric, 0);
    else
      v_all_paid := false;
    end if;
  end loop;

  if not v_found then
    raise exception 'Contributor payment row not found';
  end if;

  update public.bhishi_payments
  set sub_payments = v_next_sub_payments,
      paid = v_all_paid,
      paid_date = case when v_all_paid then coalesce(p_paid_date, current_date) else null end,
      payment_mode = case when v_all_paid then coalesce(p_payment_mode, 'offline') else null end,
      paid_amount = v_collected,
      updated_at = now()
  where id = v_payment.id;

  perform public.refresh_group_completion(p_group_id);
end;
$$;

create or replace function public.mark_bhishi_month_paid_for_all(
  p_group_id uuid,
  p_month_number integer,
  p_payment_mode public.payment_mode default 'online',
  p_paid_date date default current_date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_month record;
begin
  if v_admin_id is null then
    raise exception 'Authentication required';
  end if;

  select m.id, m.expected_amount
  into v_month
  from public.bhishi_months m
  where m.group_id = p_group_id
    and m.month_number = p_month_number
    and m.admin_id = v_admin_id;

  if v_month.id is null then
    raise exception 'Month not found';
  end if;

  update public.bhishi_payments p
  set sub_payments = (
        select jsonb_agg(jsonb_build_object(
          'contributor_id', sub_payment->>'contributor_id',
          'paid', true,
          'paid_date', coalesce(p_paid_date, current_date)::text,
          'payment_mode', p_payment_mode::text,
          'paid_amount', sub_payment->'paid_amount'
        ))
        from jsonb_array_elements(coalesce(p.sub_payments, '[]'::jsonb)) sub_payment
      ),
      paid = true,
      paid_date = coalesce(p_paid_date, current_date),
      payment_mode = p_payment_mode,
      paid_amount = v_month.expected_amount,
      updated_at = now()
  where p.month_id = v_month.id
    and p.admin_id = v_admin_id;

  perform public.refresh_group_completion(p_group_id);
end;
$$;

create or replace function public.select_bhishi_winner(
  p_group_id uuid,
  p_month_number integer,
  p_member_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_month_id uuid;
  v_payout_amount numeric;
begin
  if v_admin_id is null then
    raise exception 'Authentication required';
  end if;

  select m.id
  into v_month_id
  from public.bhishi_months m
  where m.group_id = p_group_id
    and m.month_number = p_month_number
    and m.admin_id = v_admin_id;

  if v_month_id is null then
    raise exception 'Month not found';
  end if;

  update public.bhishi_months
  set winner_member_id = p_member_id,
      is_locked = false,
      locked_at = null
  where id = v_month_id;

  perform public.refresh_bhishi_member_wins(p_group_id);

  select coalesce(sum(paid_amount), 0)
  into v_payout_amount
  from public.bhishi_payments
  where month_id = v_month_id;

  return v_payout_amount;
end;
$$;

create or replace function public.lock_bhishi_month(
  p_group_id uuid,
  p_month_number integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bhishi_months
  set is_locked = false,
      locked_at = null
  where group_id = p_group_id
    and month_number = p_month_number
    and admin_id = auth.uid();
end;
$$;

create or replace view public.bhishi_group_dashboard as
select
  g.id,
  g.admin_id,
  g.name,
  g.monthly_amount,
  g.total_members,
  g.interest_rate,
  g.start_date,
  g.payout_date,
  g.is_completed,
  g.created_at,
  count(distinct m.id) as member_count,
  count(distinct case when months.winner_member_id is not null then months.id end) as winner_month_count,
  coalesce(sum(p.paid_amount), 0) as total_collected
from public.bhishi_groups g
left join public.bhishi_members m on m.group_id = g.id
left join public.bhishi_months months on months.group_id = g.id
left join public.bhishi_payments p on p.month_id = months.id
group by g.id;

alter table public.admin_profiles enable row level security;
alter table public.bhishi_groups enable row level security;
alter table public.bhishi_members enable row level security;
alter table public.bhishi_months enable row level security;
alter table public.bhishi_payments enable row level security;

create policy "admin_profiles_select_own"
on public.admin_profiles
for select
using (id = auth.uid());

create policy "admin_profiles_update_own"
on public.admin_profiles
for update
using (id = auth.uid())
with check (id = auth.uid());

create policy "bhishi_groups_all_own"
on public.bhishi_groups
for all
using (admin_id = auth.uid())
with check (admin_id = auth.uid());

create policy "bhishi_members_all_own"
on public.bhishi_members
for all
using (admin_id = auth.uid())
with check (admin_id = auth.uid());

create policy "bhishi_months_all_own"
on public.bhishi_months
for all
using (admin_id = auth.uid())
with check (admin_id = auth.uid());

create policy "bhishi_payments_all_own"
on public.bhishi_payments
for all
using (admin_id = auth.uid())
with check (admin_id = auth.uid());

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.admin_profiles to authenticated;
grant select, insert, update, delete on public.bhishi_groups to authenticated;
grant select, insert, update, delete on public.bhishi_members to authenticated;
grant select, insert, update, delete on public.bhishi_months to authenticated;
grant select, insert, update, delete on public.bhishi_payments to authenticated;
grant select on public.bhishi_group_dashboard to authenticated;
grant execute on function public.calculate_bhishi_payment(numeric, numeric, integer, integer) to authenticated;
grant execute on function public.can_manage_month(uuid, integer) to authenticated;
grant execute on function public.split_bhishi_contributor_payments(numeric, jsonb, boolean, date, public.payment_mode) to authenticated;
grant execute on function public.rebalance_bhishi_sub_payments(jsonb, jsonb, numeric) to authenticated;
grant execute on function public.refresh_bhishi_member_wins(uuid) to authenticated;
grant execute on function public.create_bhishi_group(text, numeric, integer, numeric, date, smallint, jsonb) to authenticated;
grant execute on function public.update_bhishi_group(uuid, text, numeric, numeric, date, smallint) to authenticated;
grant execute on function public.record_bhishi_payment(uuid, integer, uuid, text, boolean, date, public.payment_mode, numeric) to authenticated;
grant execute on function public.mark_bhishi_month_paid_for_all(uuid, integer, public.payment_mode, date) to authenticated;
grant execute on function public.select_bhishi_winner(uuid, integer, uuid) to authenticated;
grant execute on function public.lock_bhishi_month(uuid, integer) to authenticated;

alter publication supabase_realtime add table public.bhishi_groups;
alter publication supabase_realtime add table public.bhishi_members;
alter publication supabase_realtime add table public.bhishi_months;
alter publication supabase_realtime add table public.bhishi_payments;

create trigger set_admin_profiles_updated_at
before update on public.admin_profiles
for each row execute function public.set_updated_at();

create trigger set_bhishi_groups_updated_at
before update on public.bhishi_groups
for each row execute function public.set_updated_at();

create trigger set_bhishi_payments_updated_at
before update on public.bhishi_payments
for each row execute function public.set_updated_at();
