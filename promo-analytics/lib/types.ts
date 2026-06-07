export type Product = {
  id: string;
  base_name: string;
  dr_code: string | null;
  category: string | null;
  cost: number | null;
  consumer_price: number | null;
  regular_price: number | null;
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

// ─────────────────────────────────────────────
// S2: 캠페인 플랜 (L2)
// ─────────────────────────────────────────────

// rate card 변동비율 (플랜 draft는 current 라이브 참조)
export type RateCard = {
  id: string;
  fee_rate: number;
  ad_rate: number;
  logistics_rate: number;
  reward_rate: number;
  is_current: boolean;
  effective_from: string;
};

// confirm 시 동결되는 rate card 스냅샷
export type RateCardSnapshot = {
  fee_rate: number;
  ad_rate: number;
  logistics_rate: number;
  reward_rate: number;
  mult: number;
  rate_card_id: string;
  snapped_at: string;
};

export type CampaignPlan = {
  id: string;
  promotion_id: string;
  version: number;
  is_current: boolean;
  status: "draft" | "confirmed";
  confirmed_at: string | null;
  rate_card_id: string | null;
  rate_card_snapshot: RateCardSnapshot | null;
  expected_revenue_total: number | null;
  expected_contribution_total: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CampaignPlanOption = {
  id: string;
  campaign_plan_id: string;
  option_label: string;
  expected_option_qty: number;
  is_main: boolean;
  match_patterns: string[];
  sort: number;
  set_price: number | null;
  consumer_total: number | null;
  regular_total: number | null;
  discount_rate_consumer: number | null;
  discount_rate_regular: number | null;
  expected_revenue: number | null;
  expected_contribution: number | null;
};

export type CampaignPlanOptionItem = {
  id: string;
  campaign_plan_option_id: string;
  product_id: string;
  base_name: string;
  sku_qty_per_option: number;
  unit_sale_price: number;
  source_config_id: string | null;
  frozen_consumer_price: number | null;
  frozen_regular_price: number | null;
  frozen_cost: number | null;
  sort: number;
};
