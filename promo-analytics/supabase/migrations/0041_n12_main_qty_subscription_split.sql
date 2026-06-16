-- 0041: '메인 제품 수량 달성' 카드를 상시/구독 분해로 표시 (predict 무영향)
--
-- 배경: 0040으로 매출·공헌이익 달성은 구독 제외로 정정됐으나, '메인 제품 수량
--   달성'은 plan_vs_actual 매칭값(e.act_qty, 구독 포함)을 그대로 사용 중. 이 캠페인은
--   메인 제품의 86%가 정기구독으로 팔려, 상시(단건)만 보면 8%(301/3,798)·구독 1,860개.
-- 사용자 결정: 카드는 '둘 다 표시' — 상시 기준(8%)을 주값으로, 구독분을 옆에 보조 표기.
--
-- 설계(저위험): plan_vs_actual / predict(campaign_achievements가 노출하는 e.*)는
--   건드리지 않는다. 요약에 '계획 SKU의 상시/구독 수량' 표시용 필드 2개만 추가.
--   actual_qty_total/ach_qty(총합=2,161/57%)는 그대로 → predict 신뢰도 불변.
--   카드 주값은 main_nonsub_qty(301) 기준, 보조로 main_subscription_qty(1,860).
--
-- 반환 컬럼 추가 → DROP + CREATE.

drop function if exists promo.plan_vs_actual_summary(uuid);
create function promo.plan_vs_actual_summary(p_id uuid)
returns table(
  has_confirmed_plan boolean,
  expected_revenue_total numeric, actual_revenue_total numeric, ach_revenue numeric,
  expected_qty_total numeric, actual_qty_total numeric, ach_qty numeric,
  expected_contribution_total numeric, actual_contribution_total numeric, ach_contribution numeric,
  unplanned_revenue numeric, unplanned_qty numeric, unplanned_contribution numeric,
  matched_sku_count integer, unsold_sku_count integer, unplanned_sku_count integer,
  quantity_reliable boolean, snapshot_mult numeric,
  subscription_revenue numeric, main_revenue numeric, halo_revenue numeric,
  campaign_revenue_total numeric, revenue_ach_total numeric,
  contribution_total numeric, contribution_ach_total numeric,
  main_nonsub_qty numeric, main_subscription_qty numeric
)
language plpgsql stable set search_path to ''
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
  plan_keys as (  -- 계획 전체 SKU(메인+서브) 정규화 키 — 상시/구독 수량 분해용
    select distinct promo.normalize_sku_name(pr.base_name) as k
    from promo.campaign_plan_option_items i
    join promo.campaign_plan_options o on o.id = i.campaign_plan_option_id
    join promo.products pr on pr.id = i.product_id
    where o.campaign_plan_id = v_plan_id
  ),
  sales as (
    select ps.revenue, coalesce(ps.cost,0) as cost, coalesce(ps.quantity,0) as qty,
      (coalesce(pr.is_subscription, false)
        or promo.is_subscription_option(ps.option_info)) as is_sub,
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
      -- 카드 표시용: 계획 SKU의 상시/구독 수량 (predict 미사용)
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

grant execute on all functions in schema promo to authenticated;
notify pgrst, 'reload schema';

select promo.refresh_rollups(true);
