-- 0036: N9 — 옵션 달성 매칭에 SKU 실적 폴백 (정확 개입 우선, 없으면 SKU 합으로)
--
-- 문제(벌크UP e4f9e870): 플랜은 모든 모래를 '8개입' 세트로 짰는데 실제 고객은 1·2·4개로만 구매
--   → (SKU, 개입=8) 정확일치 라우팅이 한 건도 안 걸려 옵션 10개 전부 0%/미매칭(노이즈).
--   현실에 없는 묶음 단위로 매칭을 시도한 것이 원인.
--
-- 해결(설계 §8.1 'SKU가 1차 진실'과 정합): 2단계 라우팅.
--   1) 정확: 매출행의 (정규화SKU, pack_size)와 일치하는 옵션에 분배 (기존 동작 유지 — 2개입/6개입 등).
--   2) 폴백: 정확 매칭된 옵션이 없는 매출행은 '같은 SKU의 모든 옵션'에 균등 분배(개입 무시).
--   → 옵션의 실적 합 = 그 SKU 실적 합과 정합. 8개입처럼 비현실 단위도 SKU 실수치로 표시.
--   match_source: 정확 기여 있으면 'routed', 폴백만이면 'sku', 수동 'manual', 없으면 'none'.
-- 반환 시그니처 동일 → CREATE OR REPLACE. 적용 후 refresh_rollups(true) 필요.

create or replace function promo.plan_vs_actual_options(p_id uuid)
returns table(
  option_id uuid,
  option_label text,
  display_label text,
  option_signature text,
  expected_option_qty numeric,
  expected_revenue numeric,
  expected_contribution numeric,
  match_patterns text[],
  matched boolean,
  match_source text,
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
    where promotion_id = p_id and is_current and status = 'confirmed'
    limit 1
  ),
  opt as (
    select o.id as option_id, o.option_label, o.display_label, o.option_signature,
      o.expected_option_qty, o.expected_revenue, o.expected_contribution,
      o.match_patterns, o.sort,
      count(i.id) as n_items,
      (array_agg(promo.normalize_sku_name(i.base_name)))[1] as solo_key,
      (array_agg(i.sku_qty_per_option))[1] as solo_pack,
      (o.match_patterns is distinct from array[o.option_label]) as manual_patterns
    from promo.campaign_plan_options o
    left join promo.campaign_plan_option_items i on i.campaign_plan_option_id = o.id
    where o.campaign_plan_id = (select id from plan)
    group by o.id, o.option_label, o.display_label, o.option_signature,
      o.expected_option_qty, o.expected_revenue, o.expected_contribution,
      o.match_patterns, o.sort
  ),
  sales as (
    select ps.id,
      promo.normalize_sku_name(pr.base_name) as skey,
      coalesce(ps.pack_size, 1) as pack,
      ps.revenue, ps.quantity, ps.option_info
    from promo.promotion_sales ps
    left join promo.promotion_sku_mappings mp
      on mp.promotion_id = ps.promotion_id and mp.actual_product_id = ps.product_id
    left join promo.products pr on pr.id = coalesce(mp.plan_product_id, ps.product_id)
    where ps.promotion_id = (select actual_pid from plan)
  ),
  -- 1) 정확: (SKU, 개입) 일치 옵션
  exact as (
    select s.id as sale_id, o.option_id, s.revenue, s.quantity
    from sales s
    join opt o on o.n_items = 1 and not o.manual_patterns
              and o.solo_key = s.skey and o.solo_pack = s.pack
  ),
  exact_n as (select sale_id, count(*) as n from exact group by sale_id),
  -- 2) 폴백: 정확 매칭 없는 매출행 → 같은 SKU의 모든 단일구성 옵션
  fb as (
    select s.id as sale_id, o.option_id, s.revenue, s.quantity
    from sales s
    join opt o on o.n_items = 1 and not o.manual_patterns and o.solo_key = s.skey
    where s.id not in (select sale_id from exact_n)
  ),
  fb_n as (select sale_id, count(*) as n from fb group by sale_id),
  routed as (
    select e.option_id,
      sum(e.revenue::numeric / en.n) as ar, sum(e.quantity::numeric / en.n) as aq,
      count(*) as n, true as is_exact
    from exact e join exact_n en on en.sale_id = e.sale_id
    group by e.option_id
    union all
    select f.option_id,
      sum(f.revenue::numeric / fn.n), sum(f.quantity::numeric / fn.n),
      count(*), false
    from fb f join fb_n fn on fn.sale_id = f.sale_id
    group by f.option_id
  ),
  routed_agg as (
    select option_id,
      sum(ar) as actual_revenue, sum(aq) as actual_qty, sum(n) as n,
      bool_or(is_exact) as has_exact
    from routed group by option_id
  ),
  manual as (
    select o.option_id,
      sum(s.revenue) as actual_revenue, sum(s.quantity) as actual_qty, count(*) as n
    from opt o
    join sales s on o.manual_patterns and exists (
      select 1 from unnest(o.match_patterns) pat
      where length(btrim(pat)) > 0
        and position(
          lower(regexp_replace(pat, '\s', '', 'g'))
          in lower(regexp_replace(coalesce(s.option_info, ''), '\s', '', 'g'))
        ) > 0
    )
    group by o.option_id
  ),
  acc as (
    select option_id, actual_revenue, actual_qty, n,
      case when has_exact then 'routed' else 'sku' end as src
    from routed_agg
    union all
    select option_id, actual_revenue, actual_qty, n, 'manual' as src
    from manual
  ),
  acc2 as (
    select option_id, max(src) as src,
      sum(actual_revenue) as actual_revenue, sum(actual_qty) as actual_qty, sum(n) as n
    from acc group by option_id
  )
  select o.option_id, o.option_label, o.display_label, o.option_signature,
    o.expected_option_qty, o.expected_revenue, o.expected_contribution,
    o.match_patterns,
    coalesce(a.n, 0) > 0 as matched,
    coalesce(a.src, case when o.manual_patterns then 'manual' else 'none' end) as match_source,
    coalesce(a.actual_revenue, 0) as actual_revenue,
    coalesce(a.actual_qty, 0) as actual_qty,
    case when coalesce(o.expected_revenue, 0) > 0
      then coalesce(a.actual_revenue, 0) / o.expected_revenue else null end as ach_revenue
  from opt o
  left join acc2 a on a.option_id = o.option_id
  order by o.sort;
$$;

grant execute on all functions in schema promo to authenticated;

notify pgrst, 'reload schema';
