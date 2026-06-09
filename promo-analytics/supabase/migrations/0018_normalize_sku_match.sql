-- 0018: SKU 자동 매칭 강화 — 정규화 이름 기반 fallback
--
-- 배경(N4 후속): 가이드 임포터(⑤)와 실적 시트(②)가 같은 SKU 를 다른 product_id 로
-- 등록하고, dr_code 도 한쪽만 채워져 product_id/dr_code 기반 자동 매칭이 실패.
-- 거의 모든 실적 SKU 에 dr_code 가 없는 상태.
--
-- 해결: 이름을 정규화한 키로 그룹화해 자동 매칭. 운영 데이터로 10/10 매칭 확인.
--   - 괄호 내용 제거: "(제품)", "(대용량)" 등 위치/접두 차이 무시
--   - 회사명 prefix "닥터펠리스" 제거
--   - 공백·구두점 제거, lowercase
--
-- 우선순위: product_id > 수동 매핑(promotion_sku_mappings) > 정규화 이름 키

create or replace function promo.normalize_sku_name(name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(name, ''), '\([^)]*\)', '', 'g'),
        '닥터펠리스', '', 'g'
      ),
      '\s+', '', 'g'
    ),
    '[\[\](){}.,/+\-]', '', 'g'
  ));
$$;

-- ── plan_vs_actual: 정규화 키 기반 매칭 ────────────────────────────────
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
  -- 플랜 SKU 들의 raw + 키
  plan_raw as (
    select i.product_id,
      pr.base_name,
      promo.normalize_sku_name(pr.base_name) as match_key,
      o.expected_option_qty * i.sku_qty_per_option as eq,
      o.expected_option_qty * i.sku_qty_per_option * i.unit_sale_price as er,
      o.expected_option_qty * i.sku_qty_per_option *
        (i.unit_sale_price * (select mult from plan) - coalesce(i.frozen_cost,0)) as ec
    from promo.campaign_plan_options o
    join promo.campaign_plan_option_items i on i.campaign_plan_option_id = o.id
    left join promo.products pr on pr.id = i.product_id
    where o.campaign_plan_id = (select id from plan)
  ),
  exp as (
    select match_key,
      (array_agg(product_id order by product_id))[1] as product_id,
      (array_agg(base_name order by base_name))[1] as base_name,
      sum(eq) as expected_qty,
      sum(er) as expected_revenue,
      sum(ec) as expected_contribution
    from plan_raw
    group by match_key
  ),
  -- 실적: 수동 매핑 적용 후 정규화 키
  mapped_sales as (
    select coalesce(m.plan_product_id, ps.product_id) as product_id,
      pr.base_name,
      promo.normalize_sku_name(pr.base_name) as match_key,
      ps.quantity, ps.revenue, ps.cost
    from promo.promotion_sales ps
    left join promo.promotion_sku_mappings m
      on m.promotion_id = ps.promotion_id and m.actual_product_id = ps.product_id
    left join promo.products pr on pr.id = coalesce(m.plan_product_id, ps.product_id)
    where ps.promotion_id = p_id and ps.product_id is not null
      and exists (select 1 from plan)
  ),
  act as (
    select match_key,
      (array_agg(product_id order by product_id))[1] as product_id,
      (array_agg(base_name order by base_name))[1] as base_name,
      sum(quantity) as actual_qty,
      sum(revenue) as actual_revenue,
      sum(revenue) * (select mult from plan) - sum(coalesce(cost,0)) as actual_contribution
    from mapped_sales
    group by match_key
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
      (e.match_key is not null and (coalesce(e.expected_qty,0) > 0 or coalesce(e.expected_revenue,0) > 0)) as has_exp,
      (a.match_key is not null and (coalesce(a.actual_qty,0) <> 0 or coalesce(a.actual_revenue,0) <> 0)) as has_act
    from exp e
    full outer join act a on a.match_key = e.match_key
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

-- ── sku_match_diagnostic: 정규화 키 기반, 자동 매칭 결과 노출 ──────────
create or replace function promo.sku_match_diagnostic(p_id uuid)
returns table (
  side text,
  product_id uuid,
  base_name text,
  dr_code text,
  expected_qty numeric,
  expected_revenue numeric,
  actual_qty numeric,
  actual_revenue numeric,
  is_mapped boolean
)
language sql
stable
set search_path = ''
as $$
  with current_plan as (
    select id from promo.campaign_plans
    where promotion_id = p_id and is_current
    order by version desc limit 1
  ),
  plan_raw as (
    select cpoi.product_id,
      pr.base_name, pr.dr_code,
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
      sum(q) as expected_qty,
      sum(r) as expected_revenue
    from plan_raw
    group by match_key
  ),
  mapped_sales as (
    select coalesce(m.plan_product_id, ps.product_id) as product_id,
      (m.plan_product_id is not null) as is_mapped,
      pr.base_name, pr.dr_code,
      promo.normalize_sku_name(pr.base_name) as match_key,
      ps.quantity, ps.revenue
    from promo.promotion_sales ps
    left join promo.promotion_sku_mappings m
      on m.promotion_id = ps.promotion_id and m.actual_product_id = ps.product_id
    left join promo.products pr on pr.id = coalesce(m.plan_product_id, ps.product_id)
    where ps.promotion_id = p_id and ps.product_id is not null
  ),
  actual_skus as (
    select match_key,
      (array_agg(product_id order by product_id))[1] as product_id,
      (array_agg(base_name order by base_name))[1] as base_name,
      (array_agg(dr_code order by dr_code) filter (where dr_code is not null))[1] as dr_code,
      bool_or(is_mapped) as is_mapped,
      sum(quantity) as actual_qty,
      sum(revenue) as actual_revenue
    from mapped_sales
    group by match_key
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
        when p.match_key is not null then 'plan'
        else 'actual'
      end as side
    from plan_skus p
    full outer join actual_skus a on a.match_key = p.match_key
  )
  select c.side, c.product_id, c.base_name, c.dr_code,
    c.expected_qty, c.expected_revenue, c.actual_qty, c.actual_revenue, c.is_mapped
  from combined c
  order by
    case c.side when 'both' then 0 when 'plan' then 1 else 2 end,
    coalesce(c.expected_revenue, 0) desc,
    coalesce(c.actual_revenue, 0) desc;
$$;

grant execute on all functions in schema promo to authenticated;

notify pgrst, 'reload schema';
