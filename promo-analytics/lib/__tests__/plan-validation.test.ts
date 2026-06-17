import { describe, it, expect } from "vitest";
import { validatePlan, type ValOption } from "@/lib/plan-validation";

const opt = (o: Partial<ValOption> & { key: string }): ValOption => ({
  key: o.key,
  option_label: o.option_label ?? o.key,
  expected_option_qty: o.expected_option_qty ?? 10,
  is_main: o.is_main ?? false,
  items: o.items ?? [{ product_id: "p1", base_name: "치킨", sku_qty_per_option: 1, unit_sale_price: 1000, cost: 400 }],
});

describe("validatePlan", () => {
  it("SKU 없는 옵션은 error", () => {
    const v = validatePlan([opt({ key: "a", items: [] })], 0.715);
    expect(v.byOption["a"].some((i) => i.code === "no-sku" && i.level === "error")).toBe(true);
    expect(v.errorCount).toBeGreaterThan(0);
  });
  it("판매단가 ≤ 원가면 warn", () => {
    const v = validatePlan(
      [opt({ key: "a", items: [{ product_id: "p", base_name: "x", sku_qty_per_option: 1, unit_sale_price: 400, cost: 400 }] })],
      0.715,
    );
    expect(v.byOption["a"].some((i) => i.code === "price-le-cost")).toBe(true);
  });
  it("동일 구성 중복 옵션 감지", () => {
    const items = [{ product_id: "p1", base_name: "치킨", sku_qty_per_option: 2, unit_sale_price: 1000, cost: 400 }];
    const v = validatePlan([opt({ key: "a", items }), opt({ key: "b", items })], 0.715);
    expect(v.byOption["a"].some((i) => i.code === "dup-composition")).toBe(true);
    expect(v.byOption["b"].some((i) => i.code === "dup-composition")).toBe(true);
  });
  it("메인 미지정이면 플랜 경고", () => {
    const v = validatePlan([opt({ key: "a", is_main: false })], 0.715);
    expect(v.plan.some((i) => i.code === "no-main")).toBe(true);
  });
  it("정상 옵션은 error 0", () => {
    const v = validatePlan([opt({ key: "a", is_main: true })], 0.715);
    expect(v.errorCount).toBe(0);
  });
});
