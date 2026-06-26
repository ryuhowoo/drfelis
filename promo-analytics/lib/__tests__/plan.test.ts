import { describe, it, expect } from "vitest";
import {
  computeOptionTotals,
  couponDiscount,
  stackedCoupons,
  freebieDeduction,
  type PlanItemInput,
  type Coupon,
} from "../plan";

// 옵션: SKU 4개 × 단가 12,500 = 세트가 50,000 / 원가 4×8,000 = 32,000
const ITEMS: PlanItemInput[] = [
  { sku_qty_per_option: 4, unit_sale_price: 12500, consumer_price: 20000, regular_price: 18000, cost: 8000 },
];
const MULT = 0.7;
const QTY = 10;

describe("couponDiscount — 조건부 쿠폰 (N원 이상 n% 최대 n원)", () => {
  it("쿠폰 없으면 0", () => {
    expect(couponDiscount(50000, null)).toBe(0);
  });
  it("기준 미달이면 0", () => {
    expect(couponDiscount(50000, { min_order_amount: 60000, discount_rate: 0.1, max_discount_amount: 0 })).toBe(0);
  });
  it("기준 충족 + 캡 없음 → 정률 할인", () => {
    expect(couponDiscount(50000, { min_order_amount: 40000, discount_rate: 0.1, max_discount_amount: 0 })).toBe(5000);
  });
  it("상한 캡 적용", () => {
    expect(couponDiscount(50000, { min_order_amount: 40000, discount_rate: 0.1, max_discount_amount: 3000 })).toBe(3000);
  });
});

describe("computeOptionTotals — 쿠폰 반영", () => {
  it("쿠폰 없으면 기존 동작 불변 (회귀 가드)", () => {
    const t = computeOptionTotals(ITEMS, MULT, QTY);
    expect(t.set_price).toBe(50000);
    expect(t.coupon_discount).toBe(0);
    expect(t.net_price).toBe(50000);
    expect(t.expected_revenue).toBe(500000);
    // (50000×0.7 − 32000) × 10 = 30,000
    expect(t.expected_contribution).toBeCloseTo(30000, 4);
  });

  it("기준 충족 쿠폰 → net_price·매출·공헌에 반영", () => {
    const t = computeOptionTotals(ITEMS, MULT, QTY, {
      min_order_amount: 40000, discount_rate: 0.1, max_discount_amount: 0,
    });
    expect(t.coupon_discount).toBe(5000);
    expect(t.net_price).toBe(45000);
    expect(t.expected_revenue).toBe(450000);
    // (45000×0.7 − 32000) × 10 = −5,000
    expect(t.expected_contribution).toBeCloseTo(-5000, 4);
    // 최종 할인율은 쿠폰 포함: 1 − 45000/80000 = 0.4375
    expect(t.discount_rate_consumer_net).toBeCloseTo(0.4375, 6);
    // 기준 할인율(쿠폰 전)은 1 − 50000/80000 = 0.375 유지
    expect(t.discount_rate_consumer).toBeCloseTo(0.375, 6);
  });

  it("상한 캡 쿠폰", () => {
    const t = computeOptionTotals(ITEMS, MULT, QTY, {
      min_order_amount: 40000, discount_rate: 0.1, max_discount_amount: 3000,
    });
    expect(t.net_price).toBe(47000);
    expect(t.expected_revenue).toBe(470000);
  });
});

describe("stackedCoupons — 다중 쿠폰 중첩", () => {
  const rate5: Coupon = { kind: "rate", min_order_amount: 50000, discount_rate: 0.05, max_discount_amount: 0, flat_amount: 0 };
  const flat5k: Coupon = { kind: "flat", min_order_amount: 50000, discount_rate: 0, max_discount_amount: 0, flat_amount: 5000 };

  it("기준 미달 쿠폰은 건너뛴다 (gross 기준 게이팅)", () => {
    const { total, per } = stackedCoupons(40000, [rate5, flat5k]);
    expect(total).toBe(0);
    expect(per).toEqual([0, 0]);
  });

  it("정률 + 정액 순차 중첩 — 정률은 직전 차감 후 running 기준", () => {
    // 80,000 → 5%(4,000) → running 76,000 → 정액 5,000 → 총 9,000
    const { total, per } = stackedCoupons(80000, [rate5, flat5k]);
    expect(per).toEqual([4000, 5000]);
    expect(total).toBe(9000);
  });

  it("정액은 남은 금액을 넘지 않는다", () => {
    const { total } = stackedCoupons(52000, [{ ...flat5k, flat_amount: 60000 }]);
    expect(total).toBe(52000);
  });
});

describe("computeOptionTotals — 다중 쿠폰 배열 + coupon_amounts", () => {
  it("쿠폰별 할인액을 순서대로 노출", () => {
    const coupons: Coupon[] = [
      { kind: "rate", min_order_amount: 50000, discount_rate: 0.05, max_discount_amount: 0, flat_amount: 0 },
      { kind: "flat", min_order_amount: 50000, discount_rate: 0, max_discount_amount: 0, flat_amount: 5000 },
    ];
    const t = computeOptionTotals(ITEMS, MULT, QTY, coupons);
    // set_price 50,000: 5% = 2,500 → running 47,500 → 정액 5,000 → net 42,500
    expect(t.coupon_amounts).toEqual([2500, 5000]);
    expect(t.coupon_discount).toBe(7500);
    expect(t.net_price).toBe(42500);
  });
});

describe("freebieDeduction — 사은품 차감 (원가×수량)", () => {
  it("원가×수량 합", () => {
    expect(
      freebieDeduction([
        { product_id: "a", base_name: "샘플A", qty: 100, cost: 1200 },
        { product_id: "b", base_name: "샘플B", qty: 50, cost: 800 },
      ]),
    ).toBe(100 * 1200 + 50 * 800);
  });
  it("빈/널이면 0", () => {
    expect(freebieDeduction([])).toBe(0);
    expect(freebieDeduction(null)).toBe(0);
  });
});
