import { describe, it, expect } from "vitest";
import {
  discountVsConsumer,
  marginRate,
  addonUnitPrice,
  contribution,
  contributionRate,
} from "../pricing";

// 시트 실데이터(DR10071): 소비자가 21,800 · 원가 4,512 · 상시가 12,900 · 할인 41% · 마진 65% · 추가구성 12,200
describe("가격 매트릭스 계산 (시트와 동일)", () => {
  it("상시가 할인율 = 1 − 상시가/소비자가", () => {
    expect(discountVsConsumer(12900, 21800, 1)).toBeCloseTo(0.408, 3);
  });
  it("묶음 할인율은 소비자가×수량 기준", () => {
    // DR10081 2묶음 47,300 / (24,900? no) — 소비자가 42,800 ×2
    expect(discountVsConsumer(47300, 42800, 2)).toBeCloseTo(0.4474, 3);
  });
  it("마진율 = (상시가 − 원가)/상시가", () => {
    expect(marginRate(12900, 4512)).toBeCloseTo(0.650, 3);
  });
  it("추가구성 = 상시가 × 0.95, 100원 내림", () => {
    expect(addonUnitPrice(12900)).toBe(12200); // 12,255 → 12,200
    expect(addonUnitPrice(24900)).toBe(23600); // 23,655 → 23,600
  });
  it("공헌이익 = 세트가 × mult − 원가 × 수량", () => {
    expect(contribution(12900, 4512, 1, 0.715)).toBeCloseTo(12900 * 0.715 - 4512, 2);
    expect(contributionRate(12900, 4512, 1, 0.715)).toBeCloseTo((12900 * 0.715 - 4512) / 12900, 4);
  });
  it("값 없으면 null", () => {
    expect(discountVsConsumer(null, 1000, 1)).toBeNull();
    expect(marginRate(null, 100)).toBeNull();
    expect(addonUnitPrice(null)).toBeNull();
    expect(contribution(null, 100, 1, 0.715)).toBeNull();
  });
});
