-- 0039: PR4 — 업로드 백필을 원자적 교체(서버 RPC, 단일 트랜잭션)로
--
-- 기존: 클라이언트가 delete 후 insert를 별도로 수행 → 중간 실패 시 부분 반영(데이터 유실) 위험.
-- 변경: 같은 기간/캠페인의 삭제 + 신규 삽입을 한 함수(=한 트랜잭션)로 처리 → 부분 반영 불가능.
--   상품 매칭(ensureProducts)은 클라에서 미리 끝내고, 파괴 구간만 RPC로 원자화.

-- 일별 매출: 같은 기간(min~max) × 같은 상품(base_names) 교체
create or replace function promo.replace_daily_sales(
  p_min date,
  p_max date,
  p_base_names text[],
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
  delete from promo.daily_sales
   where sale_date between p_min and p_max
     and base_name = any(p_base_names);

  insert into promo.daily_sales (sale_date, product_id, base_name, option_info, revenue, quantity, source_file)
  select (r->>'sale_date')::date,
         nullif(r->>'product_id', '')::uuid,
         r->>'base_name',
         coalesce(r->>'option_info', ''),
         coalesce((r->>'revenue')::numeric, 0),
         coalesce((r->>'quantity')::numeric, 0),
         r->>'source_file'
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- 캠페인 실적: 해당 캠페인의 실적 전체 교체 (확정 플랜/expected는 별도 테이블 — 영향 없음)
-- pack_size는 promotion_sales BEFORE INSERT 트리거(0030)가 자동 채움.
create or replace function promo.replace_promotion_sales(
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
  delete from promo.promotion_sales where promotion_id = p_promotion_id;

  insert into promo.promotion_sales
    (promotion_id, product_id, base_name, option_info, revenue, order_count, aov, fee, cost, quantity)
  select p_promotion_id,
         nullif(r->>'product_id', '')::uuid,
         r->>'base_name',
         r->>'option_info',
         coalesce((r->>'revenue')::numeric, 0),
         (r->>'order_count')::numeric,
         (r->>'aov')::numeric,
         (r->>'fee')::numeric,
         (r->>'cost')::numeric,
         (r->>'quantity')::numeric
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r;

  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function promo.replace_daily_sales(date, date, text[], jsonb) to authenticated;
grant execute on function promo.replace_promotion_sales(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
