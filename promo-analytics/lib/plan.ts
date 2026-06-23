// S2 캠페인 플랜 계산 — 단일 출처.
// 이 파일의 식은 migration 0007 promo.confirm_plan() 의 SQL과 동일해야 한다.
// draft: products 라이브 + rate_card current / confirmed: frozen_* + rate_card_snapshot.

// 공식몰 기본 혜택: 세트 단가 5만원 이상이면 무료배송 (정보용; 공헌이익 불변 — 물류비 12% 고정)
export const FREE_SHIP_THRESHOLD = 50000;

/** rate card 변동비율 → 공헌이익 승수 mult (= 1 − Σ rates) */
export function rateCardMult(rc: {
  fee_rate: number;
  ad_rate: number;
  logistics_rate: number;
  reward_rate: number;
}): number {
  return 1 - (rc.fee_rate + rc.ad_rate + rc.logistics_rate + rc.reward_rate);
}

/** 채널 수수료 override 반영 mult — 채널 fee 가 있으면 레이트카드 fee 대신 사용 (피드백 8) */
export function effectiveMult(
  rc: { fee_rate: number; ad_rate: number; logistics_rate: number; reward_rate: number },
  channelFeeRate: number | null | undefined,
): number {
  const fee = channelFeeRate != null ? channelFeeRate : rc.fee_rate;
  return 1 - (fee + rc.ad_rate + rc.logistics_rate + rc.reward_rate);
}

/** 단가 ↔ 소비자가 대비 할인율 양방향 바인딩 헬퍼 */
export function priceFromDiscount(consumerPrice: number, discount: number): number {
  return Math.round(consumerPrice * (1 - discount));
}
export function discountFromPrice(
  consumerPrice: number,
  price: number,
): number | null {
  return consumerPrice > 0 ? 1 - price / consumerPrice : null;
}

export type PlanItemInput = {
  sku_qty_per_option: number;
  unit_sale_price: number;
  // draft=products 라이브 / confirmed=frozen_*
  consumer_price: number | null;
  regular_price: number | null;
  cost: number | null; // 원가(VAT+)
};

/** 플랜(캠페인) 단위 조건부 쿠폰: "N원 이상 주문 시 n% 할인(최대 n원)".
   옵션 혜택가(set_price)가 기준액 이상일 때만 할인율 적용, 상한 캡. null=쿠폰 없음. */
export type CouponSpec = {
  min_order_amount: number; // N원 이상 (0 = 조건 없음)
  discount_rate: number; // n% (0~1)
  max_discount_amount: number; // 최대 n원 (0 = 캡 없음)
} | null;

/** 옵션 혜택가에 쿠폰을 적용한 할인액 (기준 미달=0, 상한 캡, 원 단위 반올림) */
export function couponDiscount(setPrice: number, coupon: CouponSpec): number {
  if (!coupon || !(coupon.discount_rate > 0)) return 0;
  if (setPrice < (coupon.min_order_amount || 0)) return 0;
  const raw = setPrice * coupon.discount_rate;
  const capped =
    coupon.max_discount_amount > 0 ? Math.min(raw, coupon.max_discount_amount) : raw;
  return Math.round(capped);
}

export type OptionTotals = {
  set_price: number; // Σ(sku_qty × unit_sale_price) — 쿠폰 전 세트 단가
  coupon_discount: number; // 이 옵션에 적용된 쿠폰 할인액 (없으면 0)
  net_price: number; // set_price − coupon_discount — 쿠폰 적용 후 실혜택가
  consumer_total: number; // Σ(consumer_price × sku_qty)
  regular_total: number; // Σ(regular_price × sku_qty)
  cost_total: number; // Σ(cost × sku_qty)
  discount_rate_consumer: number | null; // 쿠폰 전 기준 할인율
  discount_rate_regular: number | null;
  discount_rate_consumer_net: number | null; // 쿠폰 포함 최종 할인율
  expected_revenue: number; // net_price × qty
  expected_contribution: number; // (net_price × mult − cost_total) × qty
  free_shipping: boolean;
};

/** 옵션 1개 롤업: 세트 단가·할인율 이중표기·예상 매출/공헌. coupon=null이면 기존과 동일. */
export function computeOptionTotals(
  items: PlanItemInput[],
  mult: number,
  qty: number,
  coupon: CouponSpec = null,
): OptionTotals {
  let set_price = 0;
  let consumer_total = 0;
  let regular_total = 0;
  let cost_total = 0;
  for (const it of items) {
    const q = it.sku_qty_per_option || 0;
    set_price += q * (it.unit_sale_price || 0);
    consumer_total += q * (it.consumer_price || 0);
    regular_total += q * (it.regular_price || 0);
    cost_total += q * (it.cost || 0);
  }
  const expQty = qty || 0;
  const coupon_discount = couponDiscount(set_price, coupon);
  const net_price = set_price - coupon_discount;
  return {
    set_price,
    coupon_discount,
    net_price,
    consumer_total,
    regular_total,
    cost_total,
    discount_rate_consumer: consumer_total > 0 ? 1 - set_price / consumer_total : null,
    discount_rate_regular: regular_total > 0 ? 1 - set_price / regular_total : null,
    discount_rate_consumer_net:
      consumer_total > 0 ? 1 - net_price / consumer_total : null,
    expected_revenue: net_price * expQty,
    // 물류비 12%는 mult에 일괄 반영 — 무료배송 여부와 무관하게 고정
    expected_contribution: (net_price * mult - cost_total) * expQty,
    free_shipping: net_price >= FREE_SHIP_THRESHOLD,
  };
}

export type PlanOptionInput = {
  qty: number;
  totals: OptionTotals;
  items: { product_id: string; base_name: string; sku_qty_per_option: number }[];
};

export type PlanTotals = {
  expected_revenue_total: number;
  expected_contribution_total: number;
  // SKU 예상 수량 = Σ_옵션(option_qty × sku_qty_per_option) — product_id 합산
  skuExpectedQty: Map<string, { base_name: string; qty: number }>;
};

/** 플랜 합계 + SKU 단위 예상 수량 롤업 (SKU 중복 등장 허용) */
export function computePlanTotals(options: PlanOptionInput[]): PlanTotals {
  let expected_revenue_total = 0;
  let expected_contribution_total = 0;
  const skuExpectedQty = new Map<string, { base_name: string; qty: number }>();
  for (const o of options) {
    expected_revenue_total += o.totals.expected_revenue;
    expected_contribution_total += o.totals.expected_contribution;
    for (const it of o.items) {
      const add = (o.qty || 0) * (it.sku_qty_per_option || 0);
      const prev = skuExpectedQty.get(it.product_id);
      skuExpectedQty.set(it.product_id, {
        base_name: it.base_name,
        qty: (prev?.qty ?? 0) + add,
      });
    }
  }
  return { expected_revenue_total, expected_contribution_total, skuExpectedQty };
}
