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
