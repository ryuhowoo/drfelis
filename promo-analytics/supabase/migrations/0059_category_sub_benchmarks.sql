-- 0059: 카테고리 기반 서브상품 어태치율 벤치마크 + 플랜 메인 카테고리
--
-- 목적: "메인 카테고리 = X 인 과거 캠페인"에서 다른 상품들이 '메인 대비 얼마나 팔렸는지(어태치율)'를
-- 집계 → 새 플랜에서 (계획한 메인 수량 × 어태치율)로 서브 수량을 적정하게 자동 제안.
-- 0048(sub_product_benchmarks, 전역 빈도)과 별개로, 카테고리·비율 전용 RPC를 신설한다.
--
-- 메인 판별: 확정·현행 플랜의 main_product_ids(0034) → products.category 를 1차 신호로 사용하고,
-- 메인 수량은 그 메인 SKU(정규화명)와 일치하는 promotion_sale_options 수량 합으로 본다.
-- p_main_category = '전체'/null → 전 캠페인(전사 할인·n주년 분석용).

alter table promo.campaign_plans
  add column if not exists main_category text;
comment on column promo.campaign_plans.main_category is
  '플래닝 시 선택한 메인 카테고리(서브 어태치율 추천 기준). 전체=null 또는 ''전체''.';

drop function if exists promo.category_sub_benchmarks(text, int, text[]);

create function promo.category_sub_benchmarks(
  p_main_category text default null,
  p_months int default 12,
  p_exclude_skeys text[] default null
)
returns table(
  product_id uuid,
  base_name text,
  category text,
  campaigns int,
  avg_attach_ratio numeric,   -- 메인 1개당 서브 평균 수량 (캠페인별 비율의 평균)
  avg_qty numeric,            -- 등장 캠페인당 평균 절대 수량
  avg_unit_price numeric,     -- 평균 단가(매출/수량)
  consumer_price numeric,
  regular_price numeric,
  cost numeric,
  avg_discount numeric        -- 소비자가 대비 평균 할인율(0~1)
)
language sql stable security definer set search_path = ''
as $$
  with plan_main as (
    -- 확정·현행 플랜의 메인 product_id → 연결 캠페인(actual 우선)
    select coalesce(cp.actual_promotion_id, cp.promotion_id) as promotion_id,
           unnest(cp.main_product_ids) as product_id
    from promo.campaign_plans cp
    where cp.is_current and cp.status = 'confirmed'
      and cp.main_product_ids is not null and array_length(cp.main_product_ids, 1) > 0
  ),
  main_cat as (
    -- 캠페인별 메인 카테고리(최빈) + 메인 SKU 정규화 키 집합
    select pm.promotion_id,
      mode() within group (order by pr.category) filter (where pr.category is not null) as main_category,
      array_agg(distinct promo.normalize_sku_name(pr.base_name)) as main_skeys
    from plan_main pm
    join promo.products pr on pr.id = pm.product_id
    group by pm.promotion_id
  ),
  main_qty as (
    -- 메인 SKU와 일치하는 실적옵션 수량 합 = 캠페인 메인 총수량(구독 제외)
    select o.promotion_id, sum(o.quantity) as main_qty
    from promo.promotion_sale_options o
    join main_cat mc on mc.promotion_id = o.promotion_id
    join promo.promotions p on p.id = o.promotion_id
    where not o.is_subscription and o.quantity > 0
      and promo.normalize_sku_name(o.label) = any(mc.main_skeys)
      and (p_months is null or p.start_date >= (current_date - make_interval(months => p_months)))
    group by o.promotion_id
  ),
  camp as (
    select mc.promotion_id, mc.main_category, mc.main_skeys, q.main_qty
    from main_cat mc
    join main_qty q on q.promotion_id = mc.promotion_id
    where q.main_qty > 0
      and (p_main_category is null or p_main_category = '전체' or mc.main_category = p_main_category)
  ),
  sub_opt as (
    -- 풀 안 캠페인의 '서브'(메인 SKU 제외) 옵션
    select o.promotion_id, o.label, o.revenue, o.quantity, c.main_qty
    from promo.promotion_sale_options o
    join camp c on c.promotion_id = o.promotion_id
    where not o.is_subscription and o.quantity > 0
      and promo.normalize_sku_name(o.label) <> all(c.main_skeys)
  ),
  per_camp as (
    select promo.normalize_sku_name(label) as skey, promotion_id,
      sum(quantity) as qty, sum(revenue) as revenue,
      sum(quantity) / nullif(max(main_qty), 0) as attach_ratio
    from sub_opt
    group by 1, 2
  ),
  agg as (
    select skey,
      count(distinct promotion_id) as campaigns,
      avg(attach_ratio) as avg_attach_ratio,
      avg(qty) as avg_qty,
      sum(qty) as total_qty,
      sum(revenue) as total_revenue
    from per_camp
    group by skey
  ),
  prod as (
    select promo.normalize_sku_name(base_name) as skey,
      (array_agg(id order by coalesce(consumer_price, 0) desc))[1] as product_id,
      (array_agg(base_name order by coalesce(consumer_price, 0) desc))[1] as base_name,
      (array_agg(category order by coalesce(consumer_price, 0) desc nulls last))[1] as category,
      max(consumer_price) as consumer_price,
      max(regular_price) as regular_price,
      max(cost) as cost
    from promo.products
    group by 1
  )
  select pr.product_id, pr.base_name, pr.category,
    a.campaigns::int,
    round(a.avg_attach_ratio, 3) as avg_attach_ratio,
    round(a.avg_qty, 1) as avg_qty,
    round(a.total_revenue / nullif(a.total_qty, 0)) as avg_unit_price,
    pr.consumer_price, pr.regular_price, pr.cost,
    case when pr.consumer_price > 0
         then round(1 - (a.total_revenue / nullif(a.total_qty, 0)) / pr.consumer_price, 3)
         else null end as avg_discount
  from agg a
  join prod pr on pr.skey = a.skey
  where (p_exclude_skeys is null or a.skey <> all(p_exclude_skeys))
  order by a.campaigns desc, a.avg_attach_ratio desc;
$$;

grant execute on all functions in schema promo to authenticated;
notify pgrst, 'reload schema';
