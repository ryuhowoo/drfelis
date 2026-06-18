import { describe, it, expect } from "vitest";
import { explainRecommendation } from "@/lib/explain";
import type { GoalRec } from "@/lib/predict";

function rec(over: Partial<GoalRec> = {}): GoalRec {
  return {
    promo_type: "할인",
    discount_rate: 0.4,
    metric_per_day: 100,
    predicted_metric: 400,
    predicted_uplift: 4_000_000,
    predicted_uplift_contribution: 1_200_000,
    predicted_total_contribution: 3_600_000,
    contribution_rate: 0.3,
    score: 82,
    confidence: "높음",
    reliability: 0.8,
    sample: 5,
    meets_target: true,
    examples: [],
    per_goal: [
      { goal: "revenue", metric_per_day: 100, predicted_metric: 400, target: 300, meets_target: true },
    ],
    ...over,
  };
}

describe("explainRecommendation", () => {
  it("강한 1순위 추천 — 근거 다수, 리스크 없음", () => {
    const r = rec();
    const ex = explainRecommendation(r, 0, [r]);
    expect(ex.headline).toContain("할인");
    expect(ex.reasons.some((x) => x.text.includes("종합 점수가 가장 높"))).toBe(true);
    expect(ex.reasons.some((x) => x.text.includes("충족"))).toBe(true);
    expect(ex.reasons.some((x) => x.text.includes("공헌이익률"))).toBe(true);
    expect(ex.reasons.some((x) => x.text.includes("달성 신뢰도"))).toBe(true);
    expect(ex.risks).toHaveLength(0);
    expect(ex.fulfillment[0].meets).toBe(true);
  });

  it("약한 추천 — 표본·신뢰도·미달 리스크 노출", () => {
    const r = rec({
      sample: 1,
      reliability: 0.3,
      confidence: "낮음",
      discount_rate: 0.6,
      per_goal: [
        { goal: "stock", metric_per_day: 50, predicted_metric: 200, target: 1000, meets_target: false },
      ],
    });
    const ex = explainRecommendation(r, 2, [rec(), rec(), r]);
    expect(ex.risks.some((x) => x.text.includes("근거 사례"))).toBe(true);
    expect(ex.risks.some((x) => x.text.includes("계획 달성률"))).toBe(true);
    expect(ex.risks.some((x) => x.text.includes("신뢰도"))).toBe(true);
    expect(ex.risks.some((x) => x.text.includes("미달"))).toBe(true);
    expect(ex.risks.some((x) => x.text.includes("마진"))).toBe(true);
    expect(ex.headline).toContain("미달");
    expect(ex.fulfillment[0].meets).toBe(false);
  });

  it("per_goal 없으면 revenue로 fallback", () => {
    const r = rec({ per_goal: undefined, meets_target: true });
    const ex = explainRecommendation(r, 0, [r]);
    expect(ex.fulfillment[0].goal).toBe("revenue");
  });
});
