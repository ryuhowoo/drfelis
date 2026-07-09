-- 0080: 성능 — promo 스키마 FK 커버링 인덱스 (Supabase performance advisor)
--
-- 캠페인 상세/플랜/롤업 경로에서 조인·역참조되는 FK 컬럼에 인덱스가 없어
-- 시퀀셜 스캔이 발생할 수 있다(어드바이저 unindexed_foreign_keys 지적).
-- 조회가 실제로 타는 promo 스키마 컬럼만 커버 — public.*(CS 대시보드)는 건드리지 않는다.

create index if not exists promotion_sales_product_idx
  on promo.promotion_sales (product_id);

create index if not exists promotion_segment_sales_product_idx
  on promo.promotion_segment_sales (product_id);

create index if not exists promotion_notes_promotion_idx
  on promo.promotion_notes (promotion_id);

create index if not exists campaign_plan_option_items_product_idx
  on promo.campaign_plan_option_items (product_id);

create index if not exists campaign_plan_option_items_source_config_idx
  on promo.campaign_plan_option_items (source_config_id);

create index if not exists promotion_excluded_skus_product_idx
  on promo.promotion_excluded_skus (product_id);

create index if not exists promotion_main_products_product_idx
  on promo.promotion_main_products (product_id);

create index if not exists promotion_sale_options_matched_opt_idx
  on promo.promotion_sale_options (matched_plan_option_id);

create index if not exists promotion_sku_mappings_plan_product_idx
  on promo.promotion_sku_mappings (plan_product_id);

create index if not exists promotion_sku_mappings_actual_product_idx
  on promo.promotion_sku_mappings (actual_product_id);

create index if not exists product_set_items_child_idx
  on promo.product_set_items (child_product_id);

create index if not exists campaign_plans_rate_card_idx
  on promo.campaign_plans (rate_card_id);
