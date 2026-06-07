-- 0008: 달성률 (S3) — 확정 플랜(frozen) vs promotion_sales(실적)
-- 함수 3분할: plan_vs_actual / plan_vs_actual_summary / plan_vs_actual_options
-- 공헌이익은 양쪽 모두 plan rate_card_snapshot.mult 사용(비용구조 차 아닌 실제 성과만 반영).

-- per-SKU 달성률
create or replace function promo.plan_vs_actual(p_id uuid)
returns table (
  product_id uuid,
  base_name text,
  expected_qty numeric,
  expected_revenue numeric,
  expected_contribution numeric,
  actual_qty numeric,
  actual_revenue numeric,
  actual_contribution numeric,
  ach_qty numeric,
  ach_revenue numeric,
  ach_contribution numeric,
  status text
)
language sql
stable
set search_path = ''
as $$
  with plan as (
    select id, (rate_card_snapshot->>'mult')::numeric as mult
    from promo.campaign_plans
    where promotion_id = p_id and is_current and status = 'confirmed'
    limit 1
  ),
  exp as (
    select i.product_id,
           max(i.base_name) as base_name,
           sum(o.expected_option_qty * i.sku_qty_per_option) as expected_qty,
           sum(o.expected_option_qty * i.sku_qty_per_option * i.unit_sale_price) as expected_revenue,
           sum(o.expected_option_qty * i.sku_qty_per_option *
               (i.unit_sale_price * (select mult from plan) - coalesce(i.frozen_cost,0))) as expected_contribution
    from promo.campaign_plan_options o
    join promo.campaign_plan_option_items i on i.campaign_plan_option_id = o.id
    where o.campaign_plan_id = (select id from plan)
    group by i.product_id
  ),
  act as (
    select ps.product_id,
           max(ps.base_name) as base_name,
           sum(ps.quantity) as actual_qty,
           sum(ps.revenue) as actual_revenue,
           sum(ps.revenue) * (select mult from plan) - sum(coalesce(ps.cost,0)) as actual_contribution
    from promo.promotion_sales ps
    where ps.promotion_id = p_id
      and ps.product_id is not null
      and exists (select 1 from plan)
    group by ps.product_id
  ),
  j as (
    select
      coalesce(e.product_id, a.product_id) as product_id,
      coalesce(e.base_name, a.base_name) as base_name,
      coalesce(e.expected_qty,0) as expected_qty,
      coalesce(e.expected_revenue,0) as expected_revenue,
      coalesce(e.expected_contribution,0) as expected_contribution,
      coalesce(a.actual_qty,0) as actual_qty,
      coalesce(a.actual_revenue,0) as actual_revenue,
      coalesce(a.actual_contribution,0) as actual_contribution,
      (e.product_id is not null and (coalesce(e.expected_qty,0) > 0 or coalesce(e.expected_revenue,0) > 0)) as has_exp,
      (a.product_id is not null and (coalesce(a.actual_qty,0) <> 0 or coalesce(a.actual_revenue,0) <> 0)) as has_act
    from exp e
    full outer join act a on a.product_id = e.product_id
  )
  select
    product_id, base_name, expected_qty, expected_revenue, expected_contribution,
    actual_qty, actual_revenue, actual_contribution,
    case when expected_qty > 0 then actual_qty/expected_qty else null end as ach_qty,
    case when expected_revenue > 0 then actual_revenue/expected_revenue else null end as ach_revenue,
    case when expected_contribution > 0 then actual_contribution/expected_contribution else null end as ach_contribution,
    case
      when has_exp and has_act then 'matched'
      when has_exp and not has_act then 'unsold'
      else 'unplanned'
    end as status
  from j
  where has_exp or has_act;
$$;

-- 옵션 단위 보조 (match_patterns ↔ option_info 정규화 부분일치)
create or replace function promo.plan_vs_actual_options(p_id uuid)
returns table (
  option_id uuid,
  option_label text,
  expected_option_qty numeric,
  expected_revenue numeric,
  expected_contribution numeric,
  match_patterns text[],
  matched boolean,
  actual_revenue numeric,
  actual_qty numeric,
  ach_revenue numeric
)
language sql
stable
set search_path = ''
as $$
  with plan as (
    select id from promo.campaign_plans
    where promotion_id = p_id and is_current and status = 'confirmed' limit 1
  )
  select
    o.id, o.option_label, o.expected_option_qty, o.expected_revenue, o.expected_contribution,
    o.match_patterns,
    coalesce(act.matched, false) as matched,
    coalesce(act.actual_revenue, 0) as actual_revenue,
    coalesce(act.actual_qty, 0) as actual_qty,
    case when coalesce(o.expected_revenue,0) > 0 then coalesce(act.actual_revenue,0)/o.expected_revenue else null end as ach_revenue
  from promo.campaign_plan_options o
  left join lateral (
    select sum(ps.revenue) as actual_revenue, sum(ps.quantity) as actual_qty, count(*) > 0 as matched
    from promo.promotion_sales ps
    where ps.promotion_id = p_id
      and coalesce(array_length(o.match_patterns,1),0) > 0
      and exists (
        select 1 from unnest(o.match_patterns) pat
        where length(btrim(pat)) > 0
          and position(
            lower(regexp_replace(pat, '\s', '', 'g'))
            in lower(regexp_replace(coalesce(ps.option_info,''), '\s', '', 'g'))
          ) > 0
      )
  ) act on true
  where o.campaign_plan_id = (select id from plan)
  order by o.sort;
$$;

-- 전체 요약 (항상 1행)
create or replace function promo.plan_vs_actual_summary(p_id uuid)
returns table (
  has_confirmed_plan boolean,
  expected_revenue_total numeric,
  actual_revenue_total numeric,
  ach_revenue numeric,
  expected_qty_total numeric,
  actual_qty_total numeric,
  ach_qty numeric,
  expected_contribution_total numeric,
  actual_contribution_total numeric,
  ach_contribution numeric,
  unplanned_revenue numeric,
  unplanned_qty numeric,
  unplanned_contribution numeric,
  matched_sku_count int,
  unsold_sku_count int,
  unplanned_sku_count int,
  quantity_reliable boolean,
  snapshot_mult numeric
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_has boolean;
  v_mult numeric;
begin
  select true, (rate_card_snapshot->>'mult')::numeric
    into v_has, v_mult
  from promo.campaign_plans
  where promotion_id = p_id and is_current and status = 'confirmed'
  limit 1;

  if not coalesce(v_has, false) then
    return query select false,
      null::numeric, null::numeric, null::numeric,
      null::numeric, null::numeric, null::numeric,
      null::numeric, null::numeric, null::numeric,
      null::numeric, null::numeric, null::numeric,
      null::int, null::int, null::int,
      null::boolean, null::numeric;
    return;
  end if;

  return query
  with rows as (
    select * from promo.plan_vs_actual(p_id)
  ),
  exp_rows as (select * from rows where status in ('matched','unsold')),
  unp_rows as (select * from rows where status = 'unplanned')
  select
    true,
    coalesce(sum(e.expected_revenue),0),
    coalesce(sum(e.actual_revenue),0),
    case when coalesce(sum(e.expected_revenue),0) > 0 then sum(e.actual_revenue)/sum(e.expected_revenue) else null end,
    coalesce(sum(e.expected_qty),0),
    coalesce(sum(e.actual_qty),0),
    case when coalesce(sum(e.expected_qty),0) > 0 then sum(e.actual_qty)/sum(e.expected_qty) else null end,
    coalesce(sum(e.expected_contribution),0),
    coalesce(sum(e.actual_contribution),0),
    case when coalesce(sum(e.expected_contribution),0) > 0 then sum(e.actual_contribution)/sum(e.expected_contribution) else null end,
    (select coalesce(sum(actual_revenue),0) from unp_rows),
    (select coalesce(sum(actual_qty),0) from unp_rows),
    (select coalesce(sum(actual_contribution),0) from unp_rows),
    (select count(*)::int from rows where status = 'matched'),
    (select count(*)::int from rows where status = 'unsold'),
    (select count(*)::int from unp_rows),
    (coalesce(sum(e.actual_qty),0) > 0),
    v_mult
  from exp_rows e;
end;
$$;

grant execute on all functions in schema promo to authenticated;
