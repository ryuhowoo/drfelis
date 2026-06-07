export const PROMO_TYPES = [
  "할인",
  "사은품",
  "1+1",
  "2+2",
  "번들",
  "쿠폰",
  "적립",
  "런칭",
];

export const SEASON_TAGS = [
  "N주년",
  "세계 고양이의 날",
  "한국 고양이의 날",
  "명절",
  "크리스마스",
  "블랙프라이데이",
  "신학기",
  "여름",
  "겨울",
];

export const PURPOSE_TAGS = [
  "세일즈",
  "브랜딩",
  "재고소진",
  "신제품 런칭",
  "리뉴얼",
  "회원 활성화",
];

// 목적별 적합도(purpose_fit) 대표 지표 — 단일 출처(편집 용이). purpose_fit() SQL과 의미 일치.
export type PurposeFitMeta = {
  label: string;
  source: string;
  quantityDependent?: boolean; // 수량 의존 → "데이터 부족" 배지 대상
};
export const PURPOSE_FIT_METRIC: Record<string, PurposeFitMeta> = {
  세일즈: { label: "증분율 (uplift %)", source: "promotion_summary" },
  재고소진: {
    label: "수량 달성률",
    source: "plan_vs_actual_summary.ach_qty",
    quantityDependent: true,
  },
  브랜딩: {
    label: "구매 건수",
    source: "promotion_sales.order_count",
    quantityDependent: true,
  },
};
export const DEFAULT_PURPOSE_FIT: PurposeFitMeta = {
  label: "증분율 (uplift %)",
  source: "promotion_summary (fallback)",
};
export function purposeFitMeta(purpose: string): PurposeFitMeta {
  return PURPOSE_FIT_METRIC[purpose] ?? DEFAULT_PURPOSE_FIT;
}
