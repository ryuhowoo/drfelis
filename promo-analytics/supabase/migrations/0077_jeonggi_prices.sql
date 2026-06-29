-- 0077: 정기구독 가격 시드 (시트 기준)
-- 가격표에 정기구독이 비어 있던 이유는 시트 자동가져오기가 '상시'만 채웠기 때문.
-- 시트의 정기구독(단품/2묶음/4묶음) 가격을 product_price_configs(sale_mode='정기')에 입력한다.
-- 정기 할인율은 '상시가' 기준: 정기가 = 상시가 × (1-할인율) × 묶음수량. (역검산 완료)
-- 정기구독 SKU 는 사료·영양제 18종. 소포장(4.3kg/영양제)은 2 또는 4묶음, 대용량(8.3kg)은 2+4묶음.

insert into promo.product_price_configs (product_id, base_name, config_type, pack_count, sale_mode, sale_price)
select p.id, p.base_name, v.config_type,
       case v.config_type when '단품' then 1 when '2묶음' then 2 when '4묶음' then 4 else 1 end,
       '정기', v.sale_price
from (values
  -- 퓨저나이트
  ('DR10071', '4묶음',  40900),
  ('DR10081', '2묶음',  40900),
  ('DR10081', '4묶음',  80900),
  -- 카사벤토
  ('DR10030', '4묶음',  43900),
  ('DR10040', '2묶음',  43900),
  ('DR10040', '4묶음',  86900),
  ('DR10036', '4묶음',  43900),
  ('DR10033', '4묶음',  47900),
  ('DR10041', '2묶음',  47900),
  ('DR10041', '4묶음',  94900),
  -- 영양케어
  ('DR10067', '2묶음',  36900),
  ('DR10068', '2묶음',  36900),
  ('DR10063', '2묶음',  31900),
  ('DR10064', '2묶음',  31900),
  ('DR10038', '2묶음',  24900),
  ('DR10039', '2묶음',  24900),
  ('DR10011', '2묶음',  22900),
  ('DR10021', '2묶음',  22900),
  ('DR10012', '2묶음',  22900),
  ('DR10022', '2묶음',  22900),
  ('DR10072', '단품',   23900)
) as v(dr_code, config_type, sale_price)
join promo.products p on p.dr_code = v.dr_code
on conflict (product_id, sale_mode, config_type)
  do update set sale_price = excluded.sale_price, base_name = excluded.base_name, pack_count = excluded.pack_count;

notify pgrst, 'reload schema';
