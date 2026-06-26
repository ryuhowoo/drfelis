-- 0068 · 성과 달성 0원 버그 수정: is_sub 3치 논리(NULL) → null-safe
--
-- 통합 성과 RPC(replace_promotion_performance)가 만드는 promotion_sales 행은 order_type이
-- NULL이다(집계 행이라 일반/정기 혼재 → 단일 order_type 없음). 그런데 plan_vs_actual_summary의
-- is_sub 판정이 `ps.order_type = 'subscription' or ...` 라서, order_type가 NULL이면
-- 'NULL = ...' → NULL 이 되고 `filter (where not is_sub)`가 모든 행을 제외해
-- campaign_revenue_total / main_revenue / halo_revenue 가 전부 0이 됐다.
-- → hasActuals=false 로 워크플로/달성 KPI가 채워지지 않던 원인.
-- 각 항을 coalesce(...,false)로 감싸 NULL을 false로 만든다(구독 신호는 product.is_subscription·
-- 옵션명 패턴으로 유지).

create or replace function promo.plan_vs_actual_summary(p_id uuid)
returns table(has_confirmed_plan boolean, expected_revenue_total numeric, actual_revenue_total numeric, ach_revenue numeric, expected_qty_total numeric, actual_qty_total numeric, ach_qty numeric, expected_contribution_total numeric, actual_contribution_total numeric, ach_contribution numeric, unplanned_revenue numeric, unplanned_qty numeric, unplanned_contribution numeric, matched_sku_count integer, unsold_sku_count integer, unplanned_sku_count integer, quantity_reliable boolean, snapshot_mult numeric, subscription_revenue numeric, main_revenue numeric, halo_revenue numeric, campaign_revenue_total numeric, revenue_ach_total numeric, contribution_total numeric, contribution_ach_total numeric, main_nonsub_qty numeric, main_subscription_qty numeric)
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_has boolean; v_mult numeric; v_plan_id uuid; v_actual_pid uuid; v_main uuid[];
begin
  select true, (rate_card_snapshot->>'mult')::numeric, id,
         coalesce(actual_promotion_id, promotion_id), main_product_ids
    into v_has, v_mult, v_plan_id, v_actual_pid, v_main
  from promo.campaign_plans
  where promotion_id = p_id and is_current and status = 'confirmed' limit 1;

  if not coalesce(v_has, false) then
    return query select false,
      null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
      null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
      null::int, null::int, null::int, null::boolean, null::numeric,
      null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
      null::numeric, null::numeric;
    return;
  end if;

  return query
  with rows as (select * from promo.plan_vs_actual(p_id)),
  exp_rows as (select * from rows where status in ('matched','unsold')),
  unp_rows as (select * from rows where status = 'unplanned'),
  main_keys as (
    select distinct promo.normalize_sku_name(pr.base_name) as k
    from promo.campaign_plan_option_items i
    join promo.campaign_plan_options o on o.id = i.campaign_plan_option_id
    join promo.products pr on pr.id = i.product_id
    where o.campaign_plan_id = v_plan_id and (v_main is null or i.product_id = any(v_main))
  ),
  plan_keys as (
    select distinct promo.normalize_sku_name(pr.base_name) as k
    from promo.campaign_plan_option_items i
    join promo.campaign_plan_options o on o.id = i.campaign_plan_option_id
    join promo.products pr on pr.id = i.product_id
    where o.campaign_plan_id = v_plan_id
  ),
  sales as (
    select ps.revenue, coalesce(ps.cost,0) as cost, coalesce(ps.quantity,0) as qty,
      (coalesce(ps.order_type = 'subscription', false)
        or coalesce(pr.is_subscription, false)
        or coalesce(promo.is_subscription_positive(ps.option_info), false)) as is_sub,
      (promo.normalize_sku_name(pr.base_name) in (select k from main_keys)) as is_main,
      (promo.normalize_sku_name(pr.base_name) in (select k from plan_keys)) as in_plan
    from promo.promotion_sales ps
    left join promo.products pr on pr.id = ps.product_id
    where ps.promotion_id = v_actual_pid
  ),
  agg as (
    select
      coalesce(sum(revenue) filter (where is_sub), 0) as sub_rev,
      coalesce(sum(revenue) filter (where is_main and not is_sub), 0) as main_rev,
      coalesce(sum(revenue) filter (where not is_main and not is_sub), 0) as halo_rev,
      coalesce(sum(revenue) filter (where not is_sub), 0) as total_rev,
      coalesce(sum(cost) filter (where not is_sub), 0) as total_cost,
      coalesce(sum(qty) filter (where not is_sub and in_plan), 0) as main_nonsub_qty,
      coalesce(sum(qty) filter (where is_sub and in_plan), 0) as main_subscription_qty
    from sales
  ),
  e as (
    select coalesce(sum(expected_revenue),0) exp_rev, coalesce(sum(actual_revenue),0) act_rev,
      coalesce(sum(expected_qty),0) exp_qty, coalesce(sum(actual_qty),0) act_qty,
      coalesce(sum(expected_contribution),0) exp_contrib, coalesce(sum(actual_contribution),0) act_contrib
    from exp_rows
  )
  select true,
    e.exp_rev, e.act_rev,
    case when e.exp_rev > 0 then e.act_rev/e.exp_rev else null end,
    e.exp_qty, e.act_qty,
    case when e.exp_qty > 0 then e.act_qty/e.exp_qty else null end,
    e.exp_contrib, e.act_contrib,
    case when e.exp_contrib > 0 then e.act_contrib/e.exp_contrib else null end,
    (select coalesce(sum(actual_revenue),0) from unp_rows),
    (select coalesce(sum(actual_qty),0) from unp_rows),
    (select coalesce(sum(actual_contribution),0) from unp_rows),
    (select count(*)::int from rows where status = 'matched'),
    (select count(*)::int from rows where status = 'unsold'),
    (select count(*)::int from unp_rows),
    (e.act_qty > 0), v_mult,
    a.sub_rev, a.main_rev, a.halo_rev, a.total_rev,
    case when e.exp_rev > 0 then a.total_rev/e.exp_rev else null end,
    (a.total_rev * v_mult - a.total_cost),
    case when e.exp_contrib > 0 then (a.total_rev * v_mult - a.total_cost)/e.exp_contrib else null end,
    a.main_nonsub_qty, a.main_subscription_qty
  from e, agg a;
end;
$function$;
