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

grant execute on function public.update_bhishi_group(uuid, text, numeric, numeric, date, smallint) to authenticated;
