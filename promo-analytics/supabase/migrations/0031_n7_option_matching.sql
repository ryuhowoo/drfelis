-- 0031: N7 P2 — 옵션 단위 달성 best-effort 재작성 (매출 1차, 구성/pack_size 라우팅)
--
-- 배경: 기존 plan_vs_actual_options 는 match_patterns(=옵션 라벨 통짜)를 실적 자유텍스트
--   option_info 에 부분일치시키는 방식 → 라벨이 제품명이라 절대 안 걸려 모든 옵션이 0%.
--
-- 재설계(N7 §8 + 사용자 결정):
--   · 달성 1차 통화 = 매출(revenue). 실적 quantity 는 행마다 단위가 불일치(박스/포)라 참고용.
--   · 옵션↔실적 매칭 = best-effort. 단일구성 옵션을 (정규화 SKU 이름, 개입수=pack_size)로
--     실적행에 라우팅. 같은 키의 중복 옵션엔 매출을 균등 분배(총액 보존).
--   · 사용자가 직접 지정한 match_patterns(라벨 기본값과 다름)는 기존 텍스트 부분일치 유지(수동 우선).
--   · 다구성(혼합) 옵션은 단일행 라우팅 불가 → match_source='none'(저신뢰, UI에서 표기).
--   · 반환에 display_label·option_signature·match_source 추가(P3 UI용). 정규화/매핑은 SKU 엔진과 동일.
--
-- refresh_rollups 가 이 함수를 이름으로 호출 → 적용 후 refresh_rollups(true) 1회 필요.

drop function if exists promo.plan_vs_actual_options(uuid);

create function promo.plan_vs_actual_options(p_id uuid)
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
  -- 실적행: 수동 매핑 적용 후 정규화 SKU 키 + 묶음수
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
  -- best-effort: 단일구성·비수동 옵션을 (SKU키, 개입수)로 라우팅. 동일 키 옵션엔 균등 분배.
  route as (
    select s.id as sale_id, o.option_id, s.revenue, s.quantity,
      count(*) over (partition by s.id) as n_targets
    from sales s
    join opt o
      on o.n_items = 1 and not o.manual_patterns
     and o.solo_key = s.skey and o.solo_pack = s.pack
  ),
  routed as (
    select option_id, 'routed'::text as src,
      sum(revenue::numeric / n_targets) as actual_revenue,
      sum(quantity::numeric / n_targets) as actual_qty,
      count(*) as n
    from route
    group by option_id
  ),
  -- 수동 패턴 옵션: 기존 텍스트 부분일치(공백 제거 substring)
  manual as (
    select o.option_id, 'manual'::text as src,
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
    select option_id, max(src) as src,
      sum(actual_revenue) as actual_revenue, sum(actual_qty) as actual_qty, sum(n) as n
    from (select * from routed union all select * from manual) u
    group by option_id
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
  left join acc a on a.option_id = o.option_id
  order by o.sort;
$$;

grant execute on all functions in schema promo to authenticated;

notify pgrst, 'reload schema';
