-- 0017: SKU 매칭 매핑 + 진단 함수
--
-- 배경: 가이드 임포터(⑤)와 캠페인 실적 시트(②)가 각각 별개로 products 행을 만들면서
-- 같은 SKU가 다른 product_id 로 등록되는 케이스가 발생. plan_vs_actual 의 자동 매칭
-- (product_id 기준)이 비어서 달성률이 0건으로 표시됨.
--
-- 해결:
--   1) promotion_sku_mappings: 사용자가 "이 플랜 SKU = 이 실적 SKU" 수동 매핑
--   2) plan_vs_actual: 실적의 product_id 를 매핑으로 redirect 해 집계
--   3) sku_match_diagnostic: 플랜·실적 양쪽 SKU 를 한 표로 (status 무관)

-- ── 매핑 테이블 ────────────────────────────────────────────
create table if not exists promo.promotion_sku_mappings (
  promotion_id      uuid not null references promo.promotions(id) on delete cascade,
  plan_product_id   uuid not null references promo.products(id),
  actual_product_id uuid not null references promo.products(id),
  created_at        timestamptz not null default now(),
  primary key (promotion_id, plan_product_id, actual_product_id)
);

create index if not exists promotion_sku_mappings_actual_idx
  on promo.promotion_sku_mappings (promotion_id, actual_product_id);

alter table promo.promotion_sku_mappings enable row level security;
drop policy if exists promotion_sku_mappings_auth on promo.promotion_sku_mappings;
create policy promotion_sku_mappings_auth on promo.promotion_sku_mappings
  for all to authenticated using (true) with check (true);

-- ── plan_vs_actual: 매핑 적용 (실적 product_id 를 plan_product_id 로 변환) ──
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
  -- 매핑 적용: 실적의 product_id 를 plan_product_id 로 변환 (없으면 원래 값 유지)
  mapped_sales as (
    select coalesce(m.plan_product_id, ps.product_id) as product_id,
           ps.base_name, ps.quantity, ps.revenue, ps.cost
    from promo.promotion_sales ps
    left join promo.promotion_sku_mappings m
      on m.promotion_id = ps.promotion_id and m.actual_product_id = ps.product_id
    where ps.promotion_id = p_id and ps.product_id is not null
      and exists (select 1 from plan)
  ),
  act as (
    select product_id,
           max(base_name) as base_name,
           sum(quantity) as actual_qty,
           sum(revenue) as actual_revenue,
           sum(revenue) * (select mult from plan) - sum(coalesce(cost,0)) as actual_contribution
    from mapped_sales
    group by product_id
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

-- ── 진단 함수: 플랜·실적 SKU 한 표 (status 무관, draft 도 포함) ──
create or replace function promo.sku_match_diagnostic(p_id uuid)
returns table (
  side text,                  -- 'both' | 'plan' | 'actual'
  product_id uuid,
  base_name text,
  dr_code text,
  expected_qty numeric,
  expected_revenue numeric,
  actual_qty numeric,
  actual_revenue numeric,
  is_mapped boolean           -- 매핑으로 redirect 된 실적 포함 여부
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
  plan_skus as (
    select cpoi.product_id,
      max(cpoi.base_name) as base_name,
      sum(cpo.expected_option_qty * cpoi.sku_qty_per_option) as expected_qty,
      sum(cpo.expected_option_qty * cpoi.sku_qty_per_option * cpoi.unit_sale_price) as expected_revenue
    from promo.campaign_plan_options cpo
    join promo.campaign_plan_option_items cpoi on cpoi.campaign_plan_option_id = cpo.id
    where cpo.campaign_plan_id = (select id from current_plan)
    group by cpoi.product_id
  ),
  mapped_sales as (
    select coalesce(m.plan_product_id, ps.product_id) as product_id,
      m.plan_product_id is not null as is_mapped,
      ps.base_name, ps.quantity, ps.revenue
    from promo.promotion_sales ps
    left join promo.promotion_sku_mappings m
      on m.promotion_id = ps.promotion_id and m.actual_product_id = ps.product_id
    where ps.promotion_id = p_id and ps.product_id is not null
  ),
  actual_skus as (
    select product_id,
      bool_or(is_mapped) as is_mapped,
      max(base_name) as base_name,
      sum(quantity) as actual_qty,
      sum(revenue) as actual_revenue
    from mapped_sales
    group by product_id
  ),
  combined as (
    select coalesce(p.product_id, a.product_id) as product_id,
      coalesce(p.base_name, a.base_name) as base_name,
      coalesce(p.expected_qty, 0) as expected_qty,
      coalesce(p.expected_revenue, 0) as expected_revenue,
      coalesce(a.actual_qty, 0) as actual_qty,
      coalesce(a.actual_revenue, 0) as actual_revenue,
      coalesce(a.is_mapped, false) as is_mapped,
      case when p.product_id is not null and a.product_id is not null then 'both'
        when p.product_id is not null then 'plan'
        else 'actual'
      end as side
    from plan_skus p
    full outer join actual_skus a on a.product_id = p.product_id
  )
  select c.side, c.product_id, c.base_name, pr.dr_code,
    c.expected_qty, c.expected_revenue, c.actual_qty, c.actual_revenue, c.is_mapped
  from combined c
  left join promo.products pr on pr.id = c.product_id
  order by
    case c.side when 'both' then 0 when 'plan' then 1 else 2 end,
    coalesce(c.expected_revenue, 0) desc,
    coalesce(c.actual_revenue, 0) desc;
$$;

grant execute on all functions in schema promo to authenticated;
grant all on all tables in schema promo to authenticated;

notify pgrst, 'reload schema';
