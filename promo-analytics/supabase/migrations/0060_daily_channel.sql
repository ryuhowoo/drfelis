-- 0060: 일별 전체 매출 — 채널 분해
--
-- '일별 매출 추이'를 '일별 전체 매출'로 확장한다. 모든 B2C 채널(공식몰·네이버·선물하기·톡스토어·
-- 오늘의집·토스쇼핑·29CM 등) 합본을 한 번에 올리고 채널 단위로 분해 저장해, 캠페인 시점 비교를
-- 채널별로 할 수 있게 한다. 추가형: channel 컬럼 추가 + 유니크 grain에 channel 포함.
-- 기존 행은 '전체'로 채워 합계·baseline 동일성 유지(다운스트림은 채널 합산이라 불변).

alter table promo.daily_sales
  add column if not exists channel text not null default '전체';

-- 유니크 grain 재정의: (일자, 기초상품명, 옵션, 채널)
drop index if exists promo.daily_sales_uq;
create unique index if not exists daily_sales_uq
  on promo.daily_sales (sale_date, base_name, option_info, channel);

create index if not exists daily_sales_channel_idx
  on promo.daily_sales (channel, sale_date);

-- 교체 RPC: 시그니처 유지(앱 변경 최소화), 채널은 행(p_rows)에서 읽는다.
-- 합본 업로드라 [min,max]×base_names 범위의 모든 채널을 삭제 후 재삽입(원자적).
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

  insert into promo.daily_sales
    (sale_date, product_id, base_name, option_info, channel, revenue, quantity, source_file)
  select (r->>'sale_date')::date,
         nullif(r->>'product_id', '')::uuid,
         r->>'base_name',
         coalesce(r->>'option_info', ''),
         coalesce(nullif(r->>'channel', ''), '전체'),
         coalesce((r->>'revenue')::numeric, 0),
         coalesce((r->>'quantity')::numeric, 0),
         r->>'source_file'
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r;

  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function promo.replace_daily_sales(date, date, text[], jsonb) to authenticated;
notify pgrst, 'reload schema';
