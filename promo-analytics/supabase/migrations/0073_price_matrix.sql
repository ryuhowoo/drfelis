-- 0073: 가격 매트릭스 — 브랜드(카테고리 하위) + 상시/정기 모드 × 묶음 tier
--
-- products.brand: 카테고리 하위의 기초 상품 브랜드(퓨저나이트·카사벤토·포캣츄…).
-- product_price_configs.sale_mode: '상시' | '정기'. config_type 은 묶음 tier(단품/2~6묶음).
--   기존 단품/N묶음 = 상시, 기존 '정기'(0050~2단계) → sale_mode='정기', config_type='단품'.
-- unique 키를 (product_id, sale_mode, config_type) 로 확장.

alter table promo.products add column if not exists brand text;

alter table promo.product_price_configs add column if not exists sale_mode text not null default '상시';

-- 기존 '정기' 단일 tier → 정기 단품으로 이관
update promo.product_price_configs set sale_mode='정기', config_type='단품' where config_type='정기';

-- unique 키 교체 (sale_mode 포함) — 재실행 안전하게 새 제약도 먼저 drop
alter table promo.product_price_configs drop constraint if exists product_price_configs_product_id_config_type_key;
alter table promo.product_price_configs drop constraint if exists product_price_configs_pid_mode_type_key;
alter table promo.product_price_configs
  add constraint product_price_configs_pid_mode_type_key unique (product_id, sale_mode, config_type);

notify pgrst, 'reload schema';
