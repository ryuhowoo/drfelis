-- 0034: N8 P1 — 매출 중심 달성 모델 (전체 실적/목표 + 메인 수량 분리 + 구독 제외)
--
-- 배경(사용자 방향): 메인 제품을 사러 온 고객이 함께 산 '기타 제품(함께 구매)' 매출로
--   목표를 채우는 일이 많음. 메인이 예상수량만큼 안 팔려도 캠페인 전체 매출은 목표를 넘기기도.
--   → 매출 달성률 = 캠페인 전체 실적(구독 제외) / 목표(옵션 기대매출 합).
--     메인 제품은 '예상수량 vs 실제수량'을 별도로 또렷이 추적.
--
-- 비파괴: 기존 plan_vs_actual_summary 18개 컬럼/로직은 그대로 보존, 신규 7개 컬럼만 추가.
--   · subscription_revenue : 구독(정기배송/구독 텍스트) 매출
--   · main_revenue         : 메인 SKU 매출(구독 제외)
--   · halo_revenue         : 함께 구매(비메인·구독제외) 매출
--   · campaign_revenue_total: 구독 제외 전체 매출(= main + halo)
--   · revenue_ach_total    : 전체 매출 / 목표(옵션 기대매출 합)
--   · contribution_total / contribution_ach_total : 구독 제외 전체 공헌·달성률
-- 메인 정의: campaign_plans.main_product_ids (신규, null=플랜 SKU 전체가 메인). 명시 지정용.

alter table promo.campaign_plans
  add column if not exists main_product_ids uuid[];

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
  -- N8: 매출 중심(전체) 모델
  subscription_revenue numeric,
  main_revenue numeric,
  halo_revenue numeric,
  campaign_revenue_total numeric,
  revenue_ach_total numeric,
  contribution_total numeric,
  contribution_ach_total numeric
)
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_has boolean;
  v_mult numeric;
  v_plan_id uuid;
  v_actual_pid uuid;
  v_main uuid[];
begin
  select true, (rate_card_snapshot->>'mult')::numeric, id,
         coalesce(actual_promotion_id, promotion_id), main_product_ids
    into v_has, v_mult, v_plan_id, v_actual_pid, v_main
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
      null::boolean, null::numeric,
      null::numeric, null::numeric, null::numeric,
      null::numeric, null::numeric, null::numeric, null::numeric;
    return;
  end if;

  return query
  with rows as (
    select * from promo.plan_vs_actual(p_id)
  ),
  exp_rows as (select * from rows where status in ('matched','unsold')),
  unp_rows as (select * from rows where status = 'unplanned'),
  -- 메인 SKU 정규화 키: main_product_ids 지정시 그 제품만, 없으면 플랜 SKU 전체
  main_keys as (
    select distinct promo.normalize_sku_name(pr.base_name) as k
    from promo.campaign_plan_option_items i
    join promo.campaign_plan_options o on o.id = i.campaign_plan_option_id
    join promo.products pr on pr.id = i.product_id
    where o.campaign_plan_id = v_plan_id
      and (v_main is null or i.product_id = any(v_main))
  ),
  sales as (
    select ps.revenue, coalesce(ps.cost,0) as cost,
      (ps.option_info ilike '%정기배송%' or ps.option_info ilike '%구독%') as is_sub,
      (promo.normalize_sku_name(pr.base_name) in (select k from main_keys)) as is_main
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
      coalesce(sum(cost) filter (where not is_sub), 0) as total_cost
    from sales
  ),
  e as (
    select
      coalesce(sum(expected_revenue),0) as exp_rev,
      coalesce(sum(actual_revenue),0) as act_rev,
      coalesce(sum(expected_qty),0) as exp_qty,
      coalesce(sum(actual_qty),0) as act_qty,
      coalesce(sum(expected_contribution),0) as exp_contrib,
      coalesce(sum(actual_contribution),0) as act_contrib
    from exp_rows
  )
  select
    true,
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
    (e.act_qty > 0),
    v_mult,
    -- N8
    a.sub_rev,
    a.main_rev,
    a.halo_rev,
    a.total_rev,
    case when e.exp_rev > 0 then a.total_rev/e.exp_rev else null end,
    (a.total_rev * v_mult - a.total_cost),
    case when e.exp_contrib > 0 then (a.total_rev * v_mult - a.total_cost)/e.exp_contrib else null end
  from e, agg a;
end;
$function$;

grant execute on all functions in schema promo to authenticated;

notify pgrst, 'reload schema';
