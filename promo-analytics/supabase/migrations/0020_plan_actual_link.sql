-- 0020: 플랜 ↔ 실적 분리 비교 (cross-campaign achievement)
--
-- 배경: 가이드(⑤)와 실적(②) 시트가 서로 다른 캠페인 코드로 업로드되는 경우가 잦음.
-- 머지로 두 캠페인을 합치는 대신, 플랜은 플랜대로 실적은 실적대로 별개 유지하고
-- 플랜이 "비교 대상 실적 캠페인"을 명시적으로 가리키는 구조로 전환.
--
-- 모델:
--   campaign_plans.actual_promotion_id (nullable) — 비교 대상 실적 캠페인
--   null 이면 자기 캠페인의 실적을 사용 (기존 동작 = 하위 호환)
--   값이 있으면 해당 캠페인의 promotion_sales 를 actuals 로 사용
--
-- 영향 함수: plan_vs_actual, plan_vs_actual_summary, plan_vs_actual_options,
--          sku_match_diagnostic — 모두 actual_pid 를 redirect 적용해 조회

alter table promo.campaign_plans
  add column if not exists actual_promotion_id uuid references promo.promotions(id);

create index if not exists campaign_plans_actual_promo_idx
  on promo.campaign_plans (actual_promotion_id);

-- ── plan_vs_actual (confirmed plan, actuals redirect) ────────────────────
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
    select id, (rate_card_snapshot->>'mult')::numeric as mult,
      coalesce(actual_promotion_id, promotion_id) as actual_pid
    from promo.campaign_plans
    where promotion_id = p_id and is_current and status = 'confirmed'
    limit 1
  ),
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
    from plan_raw group by match_key
  ),
  mapped_sales as (
    select coalesce(m.plan_product_id, ps.product_id) as product_id,
      pr.base_name,
      promo.normalize_sku_name(pr.base_name) as match_key,
      ps.quantity, ps.revenue, ps.cost
    from promo.promotion_sales ps
    left join promo.promotion_sku_mappings m
      on m.promotion_id = ps.promotion_id and m.actual_product_id = ps.product_id
    left join promo.products pr on pr.id = coalesce(m.plan_product_id, ps.product_id)
    where ps.promotion_id = (select actual_pid from plan)
      and ps.product_id is not null
      and exists (select 1 from plan)
  ),
  act as (
    select match_key,
      (array_agg(product_id order by product_id))[1] as product_id,
      (array_agg(base_name order by base_name))[1] as base_name,
      sum(quantity) as actual_qty,
      sum(revenue) as actual_revenue,
      sum(revenue) * (select mult from plan) - sum(coalesce(cost,0)) as actual_contribution
    from mapped_sales group by match_key
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

-- ── plan_vs_actual_options (옵션 단위, actuals redirect) ────────────────
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
    select id, coalesce(actual_promotion_id, promotion_id) as actual_pid
    from promo.campaign_plans
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
    where ps.promotion_id = (select actual_pid from plan)
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

-- ── sku_match_diagnostic (draft 포함, actuals redirect) ────────────────
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
    select id, coalesce(actual_promotion_id, promotion_id) as actual_pid
    from promo.campaign_plans
    where promotion_id = p_id and is_current
    order by version desc limit 1
  ),
  -- 플랜 없으면 자기 캠페인 실적만 표시
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
    from plan_raw group by match_key
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
    where ps.promotion_id = coalesce((select actual_pid from current_plan), p_id)
      and ps.product_id is not null
  ),
  actual_skus as (
    select match_key,
      (array_agg(product_id order by product_id))[1] as product_id,
      (array_agg(base_name order by base_name))[1] as base_name,
      (array_agg(dr_code order by dr_code) filter (where dr_code is not null))[1] as dr_code,
      bool_or(is_mapped) as is_mapped,
      sum(quantity) as actual_qty,
      sum(revenue) as actual_revenue
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

-- ── 실적 캠페인 후보 목록 (실적이 있는 모든 캠페인) ─────────────────────
create or replace function promo.campaigns_with_actuals()
returns table (
  id uuid,
  name text,
  code text,
  start_date date,
  end_date date,
  actual_skus int,
  actual_revenue numeric
)
language sql
stable
set search_path = ''
as $$
  select p.id, p.name, p.code, p.start_date, p.end_date,
    count(distinct ps.product_id)::int as actual_skus,
    coalesce(sum(ps.revenue), 0) as actual_revenue
  from promo.promotions p
  join promo.promotion_sales ps on ps.promotion_id = p.id
  where ps.product_id is not null
  group by p.id, p.name, p.code, p.start_date, p.end_date
  having count(*) > 0
  order by p.start_date desc;
$$;

grant execute on all functions in schema promo to authenticated;

notify pgrst, 'reload schema';
