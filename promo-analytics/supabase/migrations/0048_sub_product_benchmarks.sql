-- 0048: 서브상품 자동 예측 벤치마크 (재설계 Phase 4)
--
-- 과거 캠페인 실적옵션을 집계해 '자주/최근 함께 판매된 상품'을 옵션단가·할인율·예상수량·
-- 원가와 함께 추천 → 플랜 작성 시 서브상품을 한 번에 채워 노가다를 줄인다.
-- 데이터 현실: products.category가 16%만 채워져 카테고리 매칭이 약함 → 빈도 기반을 1차로,
-- 카테고리/최근N개월은 선택 필터. 구독 옵션 제외.
--   p_months   : null=전 기간, N=최근 N개월
--   p_category : null=전체, 값=해당 카테고리만
--   p_exclude_skeys : 이미 플랜에 담은 정규화 SKU키 제외(옵션)

drop function if exists promo.sub_product_benchmarks(int, text, text[]);

create function promo.sub_product_benchmarks(
  p_months int default null,
  p_category text default null,
  p_exclude_skeys text[] default null
)
returns table(
  product_id uuid,
  base_name text,
  category text,
  campaigns int,
  avg_qty numeric,          -- 등장 캠페인당 평균 판매수량
  avg_unit_price numeric,   -- 평균 단가(매출/수량)
  consumer_price numeric,
  regular_price numeric,
  cost numeric,
  avg_discount numeric,     -- 소비자가 대비 평균 할인율(0~1)
  total_revenue numeric
)
language sql stable security definer set search_path = ''
as $$
  with opt as (
    select o.label, o.revenue, o.quantity, o.promotion_id
    from promo.promotion_sale_options o
    join promo.promotions p on p.id = o.promotion_id
    where not o.is_subscription and o.quantity > 0
      and (p_months is null or p.start_date >= (current_date - make_interval(months => p_months)))
  ),
  keyed as (
    select promo.normalize_sku_name(label) as skey, revenue, quantity, promotion_id from opt
  ),
  agg as (
    select skey,
      count(distinct promotion_id) as campaigns,
      sum(quantity) as total_qty,
      sum(revenue) as total_revenue
    from keyed
    group by skey
  ),
  prod as (
    select promo.normalize_sku_name(base_name) as skey,
      (array_agg(id order by coalesce(consumer_price,0) desc))[1] as product_id,
      (array_agg(base_name order by coalesce(consumer_price,0) desc))[1] as base_name,
      (array_agg(category order by coalesce(consumer_price,0) desc nulls last))[1] as category,
      max(consumer_price) as consumer_price,
      max(regular_price) as regular_price,
      max(cost) as cost
    from promo.products
    group by 1
  )
  select pr.product_id, pr.base_name, pr.category,
    a.campaigns::int,
    round(a.total_qty / nullif(a.campaigns,0), 1) as avg_qty,
    round(a.total_revenue / nullif(a.total_qty,0)) as avg_unit_price,
    pr.consumer_price, pr.regular_price, pr.cost,
    case when pr.consumer_price > 0
         then round(1 - (a.total_revenue / nullif(a.total_qty,0)) / pr.consumer_price, 3)
         else null end as avg_discount,
    a.total_revenue
  from agg a
  join prod pr on pr.skey = a.skey
  where (p_category is null or pr.category = p_category)
    and (p_exclude_skeys is null or a.skey <> all(p_exclude_skeys))
  order by a.campaigns desc, a.total_revenue desc;
$$;

grant execute on all functions in schema promo to authenticated;
notify pgrst, 'reload schema';
