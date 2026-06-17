-- 0040: N12 — 정기구독 식별을 '상품 플래그' → '주문라인(option_info)' 단위로 이동
--
-- 배경(프로드 데이터로 확인): 실적(promotion_sales)에는 '[정기구독]' 상품명이 없고,
--   같은 제품이 단건(상시)과 구독으로 동시에 팔린다(예: 데일리솔루션 퍼펙트 치킨 =
--   구독 764개 + 상시 165개). 구독 신호는 option_info의 배송주기 표기 'N개월'에만 있음.
--   → 제품 단위 플래그로는 원천적으로 분리 불가.
--
-- 결정: effective_is_sub(line) = products.is_subscription OR is_subscription_option(option_info)
--   - 라인 단위 자동 판별을 1차로, 제품 플래그는 100% 구독 상품용 '오버라이드'로 유지.
--   - 패턴('개월')은 헬퍼 한 곳에서만 관리.
-- 비파괴: 헬퍼 추가 + 두 RPC 본문 갱신. 끝에서 롤업 강제 갱신.

-- ── 1) 헬퍼: 주문라인 구독 판별 (RPC들이 참조하므로 최상단) ──────────────────
create or replace function promo.is_subscription_option(option_info text)
returns boolean language sql immutable parallel safe set search_path = ''
as $$
  -- 배송주기 표기(N개월 / N개월분)가 가장 신뢰도 높은 정기구독 신호.
  -- 추후 확장 시 여기 패턴만 수정(예: '개월|정기|구독').
  select coalesce(option_info, '') ~ '개월';
$$;

-- ── 2) plan_vs_actual_summary: is_sub 판정만 라인단위로 교체 ───────────────────
-- (반환 시그니처 0038과 동일 → CREATE OR REPLACE, refresh_rollups 자동 반영)
-- 주의: campaign_achievements(→predict)가 노출하는 ach_*/_total 매칭값(e.*)은 건드리지
--   않는다. is_sub 변경은 agg.*(구독/메인/함께구매/전체매출·공헌) 버킷에만 영향 →
--   헤드라인 '매출·공헌이익 달성(전체)'·정기구독 매출만 정정되고 predict는 무영향.
-- '메인 제품 수량 달성' 카드는 plan_vs_actual 매칭값(e.act_qty) 그대로 — 구독분 포함
--   가능(별도 PR로 plan_vs_actual 라인필터 필요). 권위 비교는 진단표의 상시/구독 분리 행.
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
        or promo.is_subscription_option(ps.option_info)) as is_sub,
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

-- ── 3) sku_match_diagnostic: 제품당 상시/구독 2행 분리 + 오버라이드 컬럼 ────────
-- 반환타입 변경(+is_subscription_override) → DROP + CREATE.
drop function if exists promo.sku_match_diagnostic(uuid);
create function promo.sku_match_diagnostic(p_id uuid)
returns table(side text, product_id uuid, base_name text, dr_code text,
  expected_qty numeric, expected_revenue numeric, actual_qty numeric, actual_revenue numeric,
  is_mapped boolean, is_subscription boolean, is_subscription_override boolean)
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
      -- 라인 단위 구독 판별(+제품 오버라이드)
      (coalesce(pr.is_subscription, false)
        or promo.is_subscription_option(ps.option_info)) as is_sub,
      ps.quantity, ps.revenue
    from promo.promotion_sales ps
    left join promo.promotion_sku_mappings m
      on m.promotion_id = ps.promotion_id and m.actual_product_id = ps.product_id
    left join promo.products pr on pr.id = coalesce(m.plan_product_id, ps.product_id)
    where ps.promotion_id = coalesce((select actual_pid from current_plan), p_id)
      and ps.product_id is not null
  ),
  actual_skus as (
    select match_key, is_sub,  -- 구독 여부를 그룹 키에 포함 → 섞인 제품은 2그룹
      (array_agg(product_id order by product_id))[1] as product_id,
      (array_agg(base_name order by base_name))[1] as base_name,
      (array_agg(dr_code order by dr_code) filter (where dr_code is not null))[1] as dr_code,
      bool_or(is_mapped) as is_mapped, sum(quantity) as actual_qty, sum(revenue) as actual_revenue
    from mapped_sales group by match_key, is_sub
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
      coalesce(a.is_sub, false) as is_subscription,
      case when p.match_key is not null and a.match_key is not null then 'both'
        when p.match_key is not null then 'plan' else 'actual' end as side
    from plan_skus p
    -- 계획 행은 '상시'(비구독) 실적에만 매칭 → 구독 실적은 별도 actual 행으로 분리
    full outer join actual_skus a
      on a.match_key = p.match_key and coalesce(a.is_sub, false) = false
  )
  select c.side, c.product_id, c.base_name, c.dr_code,
    c.expected_qty, c.expected_revenue, c.actual_qty, c.actual_revenue, c.is_mapped,
    c.is_subscription,
    coalesce(sp.is_subscription, false) as is_subscription_override
  from combined c
  left join promo.products sp on sp.id = c.product_id
  order by
    case c.side when 'both' then 0 when 'plan' then 1 else 2 end,
    c.is_subscription,  -- 상시 먼저, 구독 행 뒤로
    coalesce(c.expected_revenue, 0) desc, coalesce(c.actual_revenue, 0) desc;
$function$;

grant execute on all functions in schema promo to authenticated;
notify pgrst, 'reload schema';

-- ── 4) 롤업 강제 갱신 (campaign_rollups가 옛 JSON을 들고 있으므로 필수) ─────────
select promo.refresh_rollups(true);
