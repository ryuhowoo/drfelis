export type Product = {
  id: string;
  base_name: string;
  dr_code: string | null;
  category: string | null;
  cost: number | null; // 제품원가 (VAT+)
  cost_vat_excluded: number | null; // 제품원가 (VAT−), 참고용
  consumer_price: number | null;
  regular_price: number | null;
};

// promo.rate_card — 변동비율 파라미터 (단일 current 행 + 이력)
export type RateCard = {
  id: string;
  fee_rate: number; // 수수료 (기본 0.045)
  ad_rate: number; // 광고비 (기본 0.10)
  logistics_rate: number; // 물류비 (기본 0.12)
  reward_rate: number; // 적립금 (기본 0.02)
  effective_from: string;
  is_current: boolean;
  note: string | null;
  created_at: string;
};

// 가격 마스터 구성 종류 (v1: 단품 + N묶음)
export type PriceConfigType = "단품" | "2묶음" | "3묶음" | "4묶음" | "5묶음";

// promo.product_price_configs — SKU × 판매구성 마스터
export type ProductPriceConfig = {
  id: string;
  product_id: string;
  base_name: string;
  config_type: PriceConfigType;
  pack_count: number; // 1~5
  free_shipping: boolean;
  list_price: number | null; // 소비자가 × pack_count
  sale_price: number; // 판매가 (구성별)
  discount_rate_consumer: number | null; // (list_price − sale_price)/list_price
  discount_rate_regular: number | null; // (상시가×pack − sale_price)/(상시가×pack)
  unit_cost_total: number | null; // 원가(VAT+) × pack_count
  contribution: number | null; // sale_price × mult − unit_cost_total
  contribution_rate: number | null; // contribution / sale_price
  source_file: string | null;
  updated_at: string;
};

export type Promotion = {
  id: string;
  name: string;
  code: string | null;
  start_date: string;
  end_date: string;
  channel: string | null;
  purpose: string | null;
  purposes: string[] | null;
  promo_type: string | null;
  promo_types: string[] | null;
  season_tag: string | null;
  benefits: Benefits | null;
  contribution_amount: number | null;
  notes: string | null;
  created_at: string;
};

export type Benefits = {
  discount_rate?: number; // 0~1
  discount_amount?: number;
  gift?: { name?: string; value?: number; relevance?: string };
  mechanic?: string; // "1+1" | "2+2" | "쿠폰" 등
  extra?: string;
};

// promotion_measurement() 반환 행
export type MeasurementRow = {
  product_id: string;
  base_name: string;
  is_main: boolean;
  promo_days: number;
  observed_baseline_days: number;
  cold_start: boolean;
  baseline_daily_revenue: number;
  baseline_daily_qty: number;
  baseline_std: number;
  trend_factor: number;
  expected_revenue: number;
  expected_qty: number;
  expected_revenue_naive: number;
  actual_revenue: number;
  actual_qty: number;
  uplift_revenue: number;
  uplift_qty: number;
  uplift_ci: number;
};

// promotion_summary() 반환 행
export type PromotionSummary = {
  promo_days: number;
  direct_uplift: number;
  halo_uplift: number;
  total_uplift: number;
  halo_share: number | null;
  actual_revenue: number;
  contribution: number;
  contribution_rate: number | null;
  cold_start_count: number;
  trend_factor: number;
  uplift_ci: number;
};

export type PromotionNote = {
  id: string;
  promotion_id: string;
  author: string | null;
  question: string | null;
  answer: string | null;
  cause_tags: string[] | null;
  created_at: string;
};
