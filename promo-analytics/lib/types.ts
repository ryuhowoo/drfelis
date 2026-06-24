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
  ad_spend: number | null;
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
  // N5(0021): 플랜은 독립 아티팩트 — promotion_id는 레거시 링크(nullable)
  promotion_id: string | null;
  code: string | null;
  name: string | null;
  start_date: string | null;
  end_date: string | null;
  channel: string | null;
  target_revenue: number | null; // 플랜 헤더 목표매출 (폼값)
  target_contribution: number | null; // 플랜 공헌이익 (폼값)
  target_contribution_rate: number | null; // 폼값
  actual_promotion_id: string | null; // 실적 비교용 명시적 짝짓기 링크
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

// ─────────────────────────────────────────────
// S3: 달성률 (plan_vs_actual 함수 반환)
// ─────────────────────────────────────────────

export type PlanVsActualRow = {
  product_id: string;
  base_name: string;
  expected_qty: number;
  expected_revenue: number;
  expected_contribution: number;
  actual_qty: number;
  actual_revenue: number;
  actual_contribution: number;
  ach_qty: number | null;
  ach_revenue: number | null;
  ach_contribution: number | null;
  status: "matched" | "unsold" | "unplanned";
};

export type PlanVsActualSummary = {
  has_confirmed_plan: boolean;
  expected_revenue_total: number | null;
  actual_revenue_total: number | null;
  ach_revenue: number | null;
  expected_qty_total: number | null;
  actual_qty_total: number | null;
  ach_qty: number | null;
  expected_contribution_total: number | null;
  actual_contribution_total: number | null;
  ach_contribution: number | null;
  unplanned_revenue: number | null;
  unplanned_qty: number | null;
  unplanned_contribution: number | null;
  matched_sku_count: number | null;
  unsold_sku_count: number | null;
  unplanned_sku_count: number | null;
  quantity_reliable: boolean | null;
  snapshot_mult: number | null;
  // N8: 매출 중심(전체) 모델
  subscription_revenue: number | null;
  main_revenue: number | null;
  halo_revenue: number | null; // 함께 구매(비메인·구독제외) 매출
  campaign_revenue_total: number | null; // 구독 제외 전체
  revenue_ach_total: number | null; // 전체 / 목표
  contribution_total: number | null;
  contribution_ach_total: number | null;
  // N12: '메인 제품 수량 달성' 카드 표시용 — 계획 SKU의 상시/구독 수량 분해(predict 미사용)
  main_nonsub_qty: number | null;
  main_subscription_qty: number | null;
};

export type PlanVsActualOption = {
  option_id: string;
  option_label: string;
  // N7 P2: 구성 기반 파생 표시·식별 (라벨 단독 금지 — 2개입/6개입·세트가 구분)
  display_label: string | null;
  option_signature: string | null;
  expected_option_qty: number;
  expected_revenue: number | null;
  expected_contribution: number | null;
  match_patterns: string[];
  matched: boolean;
  // N7 P2: 'routed'(구성·묶음 자동 라우팅) | 'manual'(수동 패턴) | 'none'(미매칭/저신뢰)
  match_source: "routed" | "sku" | "manual" | "none";
  actual_revenue: number;
  actual_qty: number;
  ach_revenue: number | null;
};

// S5: 목적 가중 / 적합도
export type PurposeWeight = { purpose: string; weight: number };
export type PurposeMetric = {
  purpose: string;
  weighted_uplift: number;
  weighted_contribution: number;
  campaign_count: number;
  avg_fit_score: number | null;
  data_reliable: boolean;
};
export type PurposeFit = {
  purpose: string;
  fit_metric_raw: number | null;
  fit_score_0_100: number | null;
  data_reliable: boolean;
};

// campaign_fits() 반환 (전 캠페인 × 목적 적합도)
export type CampaignFit = {
  promotion_id: string;
  purpose: string;
  fit_score_0_100: number | null;
  data_reliable: boolean;
};

// S4: 캠페인별 달성률 (campaign_achievements 함수 반환)
export type CampaignAchievement = {
  promotion_id: string;
  name: string;
  start_date: string;
  end_date: string;
  confirmed_at: string | null;
  has_confirmed_plan: boolean;
  ach_revenue: number | null;
  ach_qty: number | null;
  ach_contribution: number | null;
  expected_revenue_total: number | null;
  actual_revenue_total: number | null;
  expected_contribution_total: number | null;
  actual_contribution_total: number | null;
  quantity_reliable: boolean | null;
};

// 0058: 세그먼트 성과 요약 (promotion_segment_summary RPC 반환)
//   회원/비회원·회원등급 코호트·일반정기·카테고리. Staff·동물병원은 excluded로 분리.
//   AOV·ARPPU는 합계에서 파생: AOV=revenue/orders, ARPPU=revenue/users.
export type SegmentRow = {
  revenue: number;
  orders: number;
  qty: number;
  users: number;
};
export type SegmentSummary = {
  has_data: boolean;
  total: SegmentRow | null;
  member_split: (SegmentRow & { seg: string })[];
  grades: (SegmentRow & { grade: string })[];
  order_types: { order_type: string; revenue: number; orders: number; qty: number }[];
  categories: { category: string; revenue: number; orders: number; qty: number }[];
  excluded: { grade: string; revenue: number; orders: number }[];
};
