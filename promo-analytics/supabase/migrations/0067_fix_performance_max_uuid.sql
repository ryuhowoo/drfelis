-- 0067 · 성과 업로드 RPC 버그 수정: max(uuid) → array_agg 픽
--
-- replace_promotion_performance 의 promotion_sales 집계에서 product_id(uuid)를 max()로
-- 골랐는데, PostgreSQL에는 uuid용 max/min 집계가 없어 "function max(uuid) does not exist"로
-- 성과 업로드가 항상 실패했다. 그룹(base_name·option) 내 product_id는 동일하므로
-- 비-NULL 중 하나를 array_agg로 고른다.

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
  -- product_id(uuid)는 max() 불가 → 그룹 내 비-NULL 하나를 array_agg로 픽.
  delete from promo.promotion_sales where promotion_id = p_promotion_id;

  insert into promo.promotion_sales
    (promotion_id, product_id, base_name, option_info, revenue, order_count, aov, fee, cost, quantity)
  select p_promotion_id,
         (array_agg(product_id) filter (where product_id is not null))[1] as product_id,
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
