-- 0037: N11 — 정기구독을 '상품(품목)' 단위로 식별 + 달성에서 제외(별도 표기 토대)
--
-- 사용자 결정: 구독은 option_info 텍스트가 아니라 '상품(품목)'으로 식별, 화면엔 제외 + 별도 섹션.
-- (Better Habits는 텍스트로 0건 — 상품 플래그가 맞는 접근)
--
-- 비파괴: products에 플래그 컬럼 추가, 집계 함수는 그 플래그를 사용(텍스트는 폴백 유지).

alter table promo.products
  add column if not exists is_subscription boolean not null default false;

-- ── plan_vs_actual_summary: 구독 식별 = 상품 플래그 or (폴백) 텍스트 ──────────
-- (반환 시그니처 0034와 동일 — 본문의 is_sub 판정만 교체)
create or replace function promo.plan_vs_actual_summary(p_id uuid)
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
  contribution_total numeric, contribution_ach_total numeric
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
      null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric;
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
  sales as (
    select ps.revenue, coalesce(ps.cost,0) as cost,
      (coalesce(pr.is_subscription, false)
        or ps.option_info ilike '%정기배송%' or ps.option_info ilike '%구독%') as is_sub,
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
    case when e.exp_contrib > 0 then (a.total_rev * v_mult - a.total_cost)/e.exp_contrib else null end
  from e, agg a;
end;
$function$;

-- ── sku_match_diagnostic: is_subscription 컬럼 추가 ──────────────────────────
drop function if exists promo.sku_match_diagnostic(uuid);
create function promo.sku_match_diagnostic(p_id uuid)
returns table(side text, product_id uuid, base_name text, dr_code text,
  expected_qty numeric, expected_revenue numeric, actual_qty numeric, actual_revenue numeric,
  is_mapped boolean, is_subscription boolean)
language sql stable set search_path to ''
as $function$
  with current_plan as (
    select id, coalesce(actual_promotion_id, promotion_id) as actual_pid
    from promo.campaign_plans where promotion_id = p_id and is_current
    order by version desc limit 1
  ),
  plan_raw as (
    select cpoi.product_id, pr.base_name, pr.dr_code,
      promo.normalize_sku_name(pr.base_name) as match_key,
      cpo.expected_option_qty * cpoi.sku_qty_per_option as q,
      cpo.expected_option_qty * cpoi.sku_qty_per_option * cpoi.unit_sale_price as r
    from promo.campaign_plan_options cpo
    join promo.campaign_plan_option_items cpoi on cpoi.campaign_plan_option_id = cpo.id
    left join promo.products pr on pr.id = cpoi.product_id
    where cpo.campaign_plan_id = (select id from current_plan)
  ),
  plan_skus as (
    select match_key,
      (array_agg(product_id order by product_id))[1] as product_id,
      (array_agg(base_name order by base_name))[1] as base_name,
      (array_agg(dr_code order by dr_code) filter (where dr_code is not null))[1] as dr_code,
      sum(q) as expected_qty, sum(r) as expected_revenue
    from plan_raw group by match_key
  ),
  mapped_sales as (
    select coalesce(m.plan_product_id, ps.product_id) as product_id,
      (m.plan_product_id is not null) as is_mapped,
      pr.base_name, pr.dr_code, promo.normalize_sku_name(pr.base_name) as match_key,
      ps.quantity, ps.revenue
    from promo.promotion_sales ps
    left join promo.promotion_sku_mappings m
      on m.promotion_id = ps.promotion_id and m.actual_product_id = ps.product_id
    left join promo.products pr on pr.id = coalesce(m.plan_product_id, ps.product_id)
    where ps.promotion_id = coalesce((select actual_pid from current_plan), p_id)
      and ps.product_id is not null
  ),
  actual_skus as (
    select match_key,
      (array_agg(product_id order by product_id))[1] as product_id,
      (array_agg(base_name order by base_name))[1] as base_name,
      (array_agg(dr_code order by dr_code) filter (where dr_code is not null))[1] as dr_code,
      bool_or(is_mapped) as is_mapped, sum(quantity) as actual_qty, sum(revenue) as actual_revenue
    from mapped_sales group by match_key
  ),
  combined as (
    select coalesce(p.product_id, a.product_id) as product_id,
      coalesce(p.base_name, a.base_name) as base_name,
      coalesce(p.dr_code, a.dr_code) as dr_code,
      coalesce(p.expected_qty, 0) as expected_qty,
      coalesce(p.expected_revenue, 0) as expected_revenue,
      coalesce(a.actual_qty, 0) as actual_qty,
      coalesce(a.actual_revenue, 0) as actual_revenue,
      coalesce(a.is_mapped, false) as is_mapped,
      case when p.match_key is not null and a.match_key is not null then 'both'
        when p.match_key is not null then 'plan' else 'actual' end as side
    from plan_skus p
    full outer join actual_skus a on a.match_key = p.match_key
  )
  select c.side, c.product_id, c.base_name, c.dr_code,
    c.expected_qty, c.expected_revenue, c.actual_qty, c.actual_revenue, c.is_mapped,
    coalesce(sp.is_subscription, false) as is_subscription
  from combined c
  left join promo.products sp on sp.id = c.product_id
  order by
    case c.side when 'both' then 0 when 'plan' then 1 else 2 end,
    coalesce(c.expected_revenue, 0) desc, coalesce(c.actual_revenue, 0) desc;
$function$;

grant execute on all functions in schema promo to authenticated;
notify pgrst, 'reload schema';
