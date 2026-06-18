import { describe, it, expect } from "vitest";
import { predict, type CaseFeature, type PredictionSpec } from "../predict";

function mkCase(over: Partial<CaseFeature> = {}): CaseFeature {
  return {
    id: "c1",
    name: "과거 캠페인",
    start_date: "2026-01-01",
    end_date: "2026-01-04",
    promo_type: "할인",
    season_tag: "여름",
    discount_rate: 0.5,
    duration_days: 4,
    uplift_per_day: 500000,
    total_uplift: 2000000,
    contribution: 600000,
    contribution_rate: 0.3,
    halo_share: 0.2,
    baseline_daily: 1000000,
    actual_daily: 1500000,
    qty_per_day: 100,
    orders_per_day: 50,
    purposes: [{ purpose: "세일즈", weight: 1 }],
    ach_revenue: 1,
    ach_contribution: 1,
    has_confirmed_plan: true,
    reliability: 1,
    ...over,
  };
}

const spec: PredictionSpec = {
  promo_type: "할인",
  season_tag: "여름",
  discount_rate: 0.5,
  duration_days: 4,
};

describe("predict — 공헌이익 증분/전체 분리", () => {
  it("증분 공헌 = 증분일평균×일수×율, 전체 공헌 = 행사일평균×일수×율 (서로 다름)", () => {
    const p = predict(spec, [mkCase()]);
    // 증분 500k/일 × 4일 × 0.3 = 600,000
    expect(p.expected_uplift_contribution).toBeCloseTo(600000, 0);
    // 전체 (1.0M+0.5M)/일 × 4일 × 0.3 = 1,800,000
    expect(p.expected_total_contribution).toBeCloseTo(1800000, 0);
    // 둘은 명확히 다르다 (예전엔 전체를 증분처럼 표기하던 버그)
    expect(p.expected_total_contribution!).toBeGreaterThan(p.expected_uplift_contribution!);
  });

  it("과거 공헌율이 전부 null이면 공헌이익은 0이 아니라 null('데이터 부족')", () => {
    const p = predict(spec, [mkCase({ contribution_rate: null })]);
    expect(p.expected_contribution_rate).toBeNull();
    expect(p.expected_uplift_contribution).toBeNull();
    expect(p.expected_total_contribution).toBeNull();
  });

  it("콜드스타트(유사 사례 없음)에서도 동일 규칙", () => {
    // 전혀 다른 promo_type/season/discount → 유사도 낮아 콜드스타트 경로
    const far = mkCase({ promo_type: "사은품", season_tag: "겨울", discount_rate: 0.0, duration_days: 30, contribution_rate: null });
    const p = predict(spec, [far]);
    expect(p.expected_total_contribution).toBeNull(); // cr null 보존
  });
});
