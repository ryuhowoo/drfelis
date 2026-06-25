-- 0062: 통합 캠페인 성과 적재 — 세그먼트 풀그레인 + promotion_sales 집계를 한 트랜잭션으로
--
-- '캠페인 성과' 통합 업로드(각 캠페인 상세의 성과 업로드)를 위한 단일 RPC. 한 파일로
--   (1) promotion_segment_sales (회원/비회원·등급·카테고리·일반/정기 풀그레인) + 카테고리 백필
--   (2) promotion_sales (base_name·option 단위 집계) — 기존 plan_vs_actual·달성률·롤업 그대로 유지
-- 를 동시에 채운다. 함수는 단일 트랜잭션이므로 둘 다 원자적으로 교체된다.
-- p_rows = 세그먼트 그레인 행(replace_promotion_segment_sales와 동일 스키마).

create or replace function promo.replace_promotion_performance(
  p_promotion_id uuid,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  -- (1) 세그먼트 풀그레인 교체 ---------------------------------------------
  delete from promo.promotion_segment_sales where promotion_id = p_promotion_id;

  insert into promo.promotion_segment_sales
    (promotion_id, product_id, base_name, option_info, category, member_type, member_grade,
     order_type, revenue, order_count, aov, arppu, paying_users, quantity, fee, cost, raw)
  select p_promotion_id,
         nullif(r->>'product_id', '')::uuid,
         r->>'base_name',
         nullif(r->>'option_info', ''),
         nullif(r->>'category', ''),
         nullif(r->>'member_type', ''),
         nullif(r->>'member_grade', ''),
         nullif(r->>'order_type', ''),
         coalesce((r->>'revenue')::numeric, 0),
         coalesce((r->>'order_count')::numeric, 0),
         nullif(r->>'aov', '')::numeric,
         nullif(r->>'arppu', '')::numeric,
         nullif(r->>'paying_users', '')::numeric,
         coalesce((r->>'quantity')::numeric, 0),
         coalesce((r->>'fee')::numeric, 0),
         coalesce((r->>'cost')::numeric, 0),
         r->'raw'
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r;

  get diagnostics n = row_count;

  -- 카테고리 백필(빈 products.category만, 정규화 SKU명 매칭) -----------------
  with seg as (
    select promo.normalize_sku_name(base_name) as skey, category, count(*) as c
    from promo.promotion_segment_sales
    where promotion_id = p_promotion_id and nullif(category, '') is not null
    group by 1, 2
  ),
  pick as (
    select distinct on (skey) skey, category from seg order by skey, c desc
  )
  update promo.products p
     set category = pick.category
    from pick
   where promo.normalize_sku_name(p.base_name) = pick.skey
     and (p.category is null or p.category = '');

  -- (2) promotion_sales 집계 교체 (달성률·롤업 호환) -----------------------
  -- 세그먼트(회원/등급/일반·정기)를 base_name·option 단위로 합산. aov는 매출/건수로 재계산.
  delete from promo.promotion_sales where promotion_id = p_promotion_id;

  insert into promo.promotion_sales
    (promotion_id, product_id, base_name, option_info, revenue, order_count, aov, fee, cost, quantity)
  select p_promotion_id,
         max(product_id)                                          as product_id,
         base_name,
         coalesce(option_info, '')                                as option_info,
         sum(revenue)                                             as revenue,
         sum(order_count)                                         as order_count,
         case when sum(order_count) > 0
              then sum(revenue) / sum(order_count) else null end  as aov,
         sum(fee)                                                 as fee,
         sum(cost)                                                as cost,
         sum(quantity)                                            as quantity
  from promo.promotion_segment_sales
  where promotion_id = p_promotion_id
  group by base_name, coalesce(option_info, '');

  return n;
end;
$$;

grant execute on function promo.replace_promotion_performance(uuid, jsonb) to authenticated;
notify pgrst, 'reload schema';
