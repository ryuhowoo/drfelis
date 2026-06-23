-- 0050: SKU 품절(미판매) 제외 (피드백 1)
--
-- 매출 0(품절·미판매)인 플랜 SKU를 '품절 처리'하면 플랜·성과(달성률)·미매칭에서 모두 제외.
-- → 매칭 검증을 완료할 수 있고, 안 팔린 품절품이 달성률을 끌어내리지 않는다.
-- plan_vs_actual / sku_match_diagnostic 의 plan_raw 에서 동일 기준(promotion_id+product_id)으로 빠진다.
-- (두 함수는 현재 운영본 정의를 그대로 옮기고 plan_raw WHERE 에 not exists 필터만 추가)

create table if not exists promo.promotion_excluded_skus (
  promotion_id uuid not null references promo.promotions(id) on delete cascade,
  product_id   uuid not null references promo.products(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (promotion_id, product_id)
);
alter table promo.promotion_excluded_skus enable row level security;
drop policy if exists promotion_excluded_skus_auth on promo.promotion_excluded_skus;
create policy promotion_excluded_skus_auth on promo.promotion_excluded_skus
  for all to authenticated using (true) with check (true);

create or replace function promo.plan_vs_actual(p_id uuid)
 returns table(product_id uuid, base_name text, expected_qty numeric, expected_revenue numeric, expected_contribution numeric, actual_qty numeric, actual_revenue numeric, actual_contribution numeric, ach_qty numeric, ach_revenue numeric, ach_contribution numeric, status text)
 language sql stable set search_path to '' as $function$
  with plan as (
    select id, (rate_card_snapshot->>'mult')::numeric as mult,
      coalesce(actual_promotion_id, promotion_id) as actual_pid
    from promo.campaign_plans
    where promotion_id = p_id and is_current and status = 'confirmed' limit 1
  ),
  plan_raw as (
    select i.product_id, pr.base_name,
      promo.normalize_sku_name(pr.base_name) as match_key,
      o.expected_option_qty * i.sku_qty_per_option as eq,
      o.expected_option_qty * i.sku_qty_per_option * i.unit_sale_price as er,
      o.expected_option_qty * i.sku_qty_per_option *
        (i.unit_sale_price * (select mult from plan) - coalesce(i.frozen_cost,0)) as ec
    from promo.campaign_plan_options o
    join promo.campaign_plan_option_items i on i.campaign_plan_option_id = o.id
    left join promo.products pr on pr.id = i.product_id
    where o.campaign_plan_id = (select id from plan)
      and not exists (select 1 from promo.promotion_excluded_skus x
        where x.promotion_id = p_id and x.product_id = i.product_id)
  ),
  exp as (
    select match_key,
      (array_agg(product_id order by product_id))[1] as product_id,
      (array_agg(base_name order by base_name))[1] as base_name,
      sum(eq) as expected_qty, sum(er) as expected_revenue, sum(ec) as expected_contribution
    from plan_raw group by match_key
  ),
  mapped_sales as (
    select coalesce(m.plan_product_id, ps.product_id) as product_id, pr.base_name,
      promo.normalize_sku_name(pr.base_name) as match_key, ps.quantity, ps.revenue, ps.cost
    from promo.promotion_sales ps
    left join promo.promotion_sku_mappings m
      on m.promotion_id = ps.promotion_id and m.actual_product_id = ps.product_id
    left join promo.products pr on pr.id = coalesce(m.plan_product_id, ps.product_id)
    where ps.promotion_id = (select actual_pid from plan)
      and ps.product_id is not null and exists (select 1 from plan)
  ),
  act as (
    select match_key,
      (array_agg(product_id order by product_id))[1] as product_id,
      (array_agg(base_name order by base_name))[1] as base_name,
      sum(quantity) as actual_qty, sum(revenue) as actual_revenue,
      sum(revenue) * (select mult from plan) - sum(coalesce(cost,0)) as actual_contribution
    from mapped_sales group by match_key
  ),
  j as (
    select coalesce(e.product_id, a.product_id) as product_id,
      coalesce(e.base_name, a.base_name) as base_name,
      coalesce(e.expected_qty,0) as expected_qty,
      coalesce(e.expected_revenue,0) as expected_revenue,
      coalesce(e.expected_contribution,0) as expected_contribution,
      coalesce(a.actual_qty,0) as actual_qty,
      coalesce(a.actual_revenue,0) as actual_revenue,
      coalesce(a.actual_contribution,0) as actual_contribution,
      (e.match_key is not null and (coalesce(e.expected_qty,0) > 0 or coalesce(e.expected_revenue,0) > 0)) as has_exp,
      (a.match_key is not null and (coalesce(a.actual_qty,0) <> 0 or coalesce(a.actual_revenue,0) <> 0)) as has_act
    from exp e full outer join act a on a.match_key = e.match_key
  )
  select product_id, base_name, expected_qty, expected_revenue, expected_contribution,
    actual_qty, actual_revenue, actual_contribution,
    case when expected_qty > 0 then actual_qty/expected_qty else null end as ach_qty,
    case when expected_revenue > 0 then actual_revenue/expected_revenue else null end as ach_revenue,
    case when expected_contribution > 0 then actual_contribution/expected_contribution else null end as ach_contribution,
    case when has_exp and has_act then 'matched' when has_exp and not has_act then 'unsold' else 'unplanned' end as status
  from j where has_exp or has_act;
$function$;

create or replace function promo.sku_match_diagnostic(p_id uuid)
 returns table(side text, product_id uuid, base_name text, dr_code text, expected_qty numeric, expected_revenue numeric, actual_qty numeric, actual_revenue numeric, is_mapped boolean, is_subscription boolean, is_subscription_override boolean)
 language sql stable set search_path to '' as $function$
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
      and not exists (select 1 from promo.promotion_excluded_skus x
        where x.promotion_id = p_id and x.product_id = cpoi.product_id)
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
      (coalesce(pr.is_subscription, false)
        or promo.is_subscription_positive(ps.option_info)) as is_sub,
      ps.quantity, ps.revenue
    from promo.promotion_sales ps
    left join promo.promotion_sku_mappings m
      on m.promotion_id = ps.promotion_id and m.actual_product_id = ps.product_id
    left join promo.products pr on pr.id = coalesce(m.plan_product_id, ps.product_id)
    where ps.promotion_id = coalesce((select actual_pid from current_plan), p_id)
      and ps.product_id is not null
  ),
  actual_skus as (
    select match_key, is_sub,
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
    c.is_subscription,
    coalesce(c.expected_revenue, 0) desc, coalesce(c.actual_revenue, 0) desc;
$function$;

grant execute on all functions in schema promo to authenticated;
grant all on all tables in schema promo to authenticated;
notify pgrst, 'reload schema';
