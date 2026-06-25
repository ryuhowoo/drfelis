-- 0064 · 서브상품 어태치율 벤치마크 재설계 (카테고리 반응성 수정)
--
-- 문제: 기존 category_sub_benchmarks는 '확정 플랜 + main_product_ids'가 있는 캠페인만
--   풀로 삼았다. 그런 캠페인이 2개뿐이라, 카테고리로 거른 표본이 2건 미만이면 전체로 폴백
--   → 메인 카테고리를 바꿔도 결과가 그대로였다.
--
-- 해결: 과거 '모든' 캠페인의 실제 판매(promotion_sale_options)를 쓴다. 선택 메인 카테고리 C에 대해
--   캠페인별 main_qty = 그 캠페인에서 팔린 C 카테고리 상품 수량으로 잡고, C가 '아닌' 상품을
--   서브로 보아 어태치율(= 서브수량 / main_qty)을 캠페인 평균낸다. 전사 세일이라 대부분의
--   캠페인이 C를 일부라도 팔기 때문에 표본이 충분하고, C를 바꾸면 분모(main_qty)와 서브 집합이
--   모두 바뀌어 추천 수량이 실제로 달라진다.  '전체'/null = 캠페인 전체 수량 대비(전역 빈도).

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
  avg_attach_ratio numeric,
  avg_qty numeric,
  avg_unit_price numeric,
  consumer_price numeric,
  regular_price numeric,
  cost numeric,
  avg_discount numeric,
  total_revenue numeric
)
language sql
stable
as $$
  with
  -- 1) 정규화 SKU → 대표 상품·카테고리 (최고 소비자가 우선)
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
  ),
  -- 2) 과거 캠페인의 비구독 판매 옵션 + 카테고리 (기간 필터)
  opt as (
    select o.promotion_id,
      promo.normalize_sku_name(o.label) as skey,
      o.revenue, o.quantity, pr.category as opt_category
    from promo.promotion_sale_options o
    join promo.promotions p on p.id = o.promotion_id
    left join prod pr on pr.skey = promo.normalize_sku_name(o.label)
    where not o.is_subscription and o.quantity > 0
      and (p_months is null or p.start_date >= (current_date - make_interval(months => p_months)))
  ),
  -- 3) 캠페인별 메인 수량 = 선택 카테고리 상품의 합계 수량 ('전체'=캠페인 전체 수량)
  camp_main as (
    select promotion_id, sum(quantity) as main_qty
    from opt
    where p_main_category is null
       or p_main_category = '전체'
       or opt_category = p_main_category
    group by promotion_id
  ),
  -- 4) 서브 옵션 = 선택 카테고리가 '아닌' 상품 ('전체'=모든 상품)
  sub_opt as (
    select o.promotion_id, o.skey, o.revenue, o.quantity, cm.main_qty
    from opt o
    join camp_main cm on cm.promotion_id = o.promotion_id
    where cm.main_qty > 0
      and (
        p_main_category is null
        or p_main_category = '전체'
        or o.opt_category is distinct from p_main_category
      )
  ),
  per_camp as (
    select skey, promotion_id,
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
  )
  select pr.product_id, pr.base_name, pr.category,
    a.campaigns::int,
    round(a.avg_attach_ratio, 3) as avg_attach_ratio,
    round(a.avg_qty, 1) as avg_qty,
    round(a.total_revenue / nullif(a.total_qty, 0)) as avg_unit_price,
    pr.consumer_price, pr.regular_price, pr.cost,
    case when pr.consumer_price > 0
         then round(1 - (a.total_revenue / nullif(a.total_qty, 0)) / pr.consumer_price, 3)
         else null end as avg_discount,
    a.total_revenue
  from agg a
  join prod pr on pr.skey = a.skey
  where (p_exclude_skeys is null or a.skey <> all(p_exclude_skeys))
  order by a.campaigns desc, a.avg_attach_ratio desc nulls last;
$$;

grant execute on function promo.category_sub_benchmarks(text, int, text[]) to authenticated, anon, service_role;
