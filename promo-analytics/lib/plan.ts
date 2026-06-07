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

export type OptionTotals = {
  set_price: number; // Σ(sku_qty × unit_sale_price)
  consumer_total: number; // Σ(consumer_price × sku_qty)
  regular_total: number; // Σ(regular_price × sku_qty)
  cost_total: number; // Σ(cost × sku_qty)
  discount_rate_consumer: number | null;
  discount_rate_regular: number | null;
  expected_revenue: number;
  expected_contribution: number;
  free_shipping: boolean;
};

/** 옵션 1개 롤업: 세트 단가·할인율 이중표기·예상 매출/공헌 */
export function computeOptionTotals(
  items: PlanItemInput[],
  mult: number,
  qty: number,
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
  return {
    set_price,
    consumer_total,
    regular_total,
    cost_total,
    discount_rate_consumer: consumer_total > 0 ? 1 - set_price / consumer_total : null,
    discount_rate_regular: regular_total > 0 ? 1 - set_price / regular_total : null,
    expected_revenue: set_price * expQty,
    // 물류비 12%는 mult에 일괄 반영 — 무료배송 여부와 무관하게 고정
    expected_contribution: (set_price * mult - cost_total) * expQty,
    free_shipping: set_price >= FREE_SHIP_THRESHOLD,
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
