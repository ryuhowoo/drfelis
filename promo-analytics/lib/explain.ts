// PR7: 추천 설명가능성 — "왜 이 추천인가?"에 답하는 근거·리스크·충족도.
// 순수 헬퍼(테스트 대상). GoalRec와 숫자 포맷만 의존.

import type { GoalRec, Goal } from "./predict";
import { won, num, pct } from "./format";

export type ReasonTone = "good" | "warn" | "info";
export type Reason = { tone: ReasonTone; text: string };

export type Explanation = {
  headline: string; // 한 줄 요약(왜 이 추천인가)
  reasons: Reason[]; // 추천 근거
  risks: Reason[]; // 주의해야 할 리스크
  fulfillment: { goal: Goal; label: string; ratio: number | null; meets: boolean }[];
};

const GOAL_LABEL: Record<Goal, string> = {
  revenue: "세일즈",
  stock: "재고소진",
  branding: "브랜딩",
};

const GOAL_UNIT: Record<Goal, "won" | "qty" | "orders"> = {
  revenue: "won",
  stock: "qty",
  branding: "orders",
};

function fmtMetric(goal: Goal, v: number): string {
  const u = GOAL_UNIT[goal];
  if (u === "won") return won(v);
  if (u === "qty") return `${num(v)}개`;
  return `${num(v)}건`;
}

// 추천 1건에 대한 설명 생성.
// rank: 정렬된 추천 목록에서의 0-based 순위. allRecs: 상대 비교(최고 점수 등)용.
export function explainRecommendation(
  rec: GoalRec,
  rank: number,
  allRecs: GoalRec[],
): Explanation {
  const reasons: Reason[] = [];
  const risks: Reason[] = [];

  // 충족도 (목표 대비) — per_goal 우선, 없으면 단일 revenue로 fallback
  const perGoal = rec.per_goal ?? [
    {
      goal: "revenue" as Goal,
      metric_per_day: rec.metric_per_day,
      predicted_metric: rec.predicted_metric,
      target: 0,
      meets_target: rec.meets_target,
    },
  ];
  const fulfillment = perGoal.map((pg) => ({
    goal: pg.goal,
    label: GOAL_LABEL[pg.goal],
    ratio: pg.target > 0 ? pg.predicted_metric / pg.target : null,
    meets: pg.meets_target,
  }));

  // ── 근거 ──
  // 1) 순위/점수
  if (rank === 0) {
    reasons.push({
      tone: "good",
      text: `후보 ${allRecs.length}개 중 종합 점수가 가장 높습니다 (${rec.score}점).`,
    });
  } else {
    reasons.push({
      tone: "info",
      text: `종합 점수 ${rec.score}점으로 ${rank + 1}순위 후보입니다.`,
    });
  }

  // 2) 목표 충족
  const unmet = fulfillment.filter((f) => f.ratio != null && !f.meets);
  const met = fulfillment.filter((f) => f.ratio != null && f.meets);
  if (met.length > 0 && unmet.length === 0) {
    reasons.push({
      tone: "good",
      text:
        met.length === 1
          ? `목표 ‘${met[0].label}’를 충족할 것으로 예측됩니다 (${Math.round((met[0].ratio ?? 0) * 100)}%).`
          : `선택한 ${met.length}개 목표를 모두 충족할 것으로 예측됩니다.`,
    });
  }

  // 3) 수익성(공헌이익률)
  if (rec.contribution_rate != null && rec.contribution_rate >= 0.2) {
    reasons.push({
      tone: "good",
      text: `예상 공헌이익률이 ${pct(rec.contribution_rate, 0)}로 수익성이 좋은 구간입니다.`,
    });
  }

  // 4) 달성 신뢰도(과거 계획 달성 패턴)
  if (rec.reliability >= 0.66) {
    reasons.push({
      tone: "good",
      text: `유사 캠페인의 계획 달성 신뢰도가 ${Math.round(rec.reliability * 100)}%로 안정적입니다.`,
    });
  }

  // 5) 근거 표본
  reasons.push({
    tone: rec.sample >= 3 ? "info" : "warn",
    text: `유사 사례 ${rec.sample}건을 근거로 예측했습니다.`,
  });

  // ── 리스크 ──
  if (rec.sample < 3) {
    risks.push({
      tone: "warn",
      text: `근거 사례가 ${rec.sample}건으로 적어 예측 변동성이 큽니다. 보수적으로 해석하세요.`,
    });
  }
  if (rec.reliability < 0.5) {
    risks.push({
      tone: "warn",
      text: `유사 캠페인의 계획 달성률이 낮아(${Math.round(rec.reliability * 100)}%) 실제 결과가 어긋날 수 있습니다.`,
    });
  }
  if (rec.confidence === "낮음") {
    risks.push({ tone: "warn", text: "예측 신뢰도가 ‘낮음’입니다. 참고 지표로만 활용하세요." });
  }
  for (const f of unmet) {
    risks.push({
      tone: "warn",
      text: `목표 ‘${f.label}’는 예측 ${Math.round((f.ratio ?? 0) * 100)}% 수준으로 미달이 예상됩니다.`,
    });
  }
  if (rec.discount_rate != null && rec.discount_rate >= 0.5) {
    risks.push({
      tone: "warn",
      text: `할인 깊이가 ${pct(rec.discount_rate, 0)}로 커 마진 훼손 위험이 있습니다.`,
    });
  }

  // ── 헤드라인 ──
  const primaryGoal = perGoal[0]?.goal ?? "revenue";
  const cond =
    `${rec.promo_type}` + (rec.discount_rate != null ? ` ${pct(rec.discount_rate, 0)} 할인` : "");
  let headline: string;
  if (rank === 0 && unmet.length === 0) {
    headline = `${cond} — 목표를 충족하면서 공헌이익·달성 신뢰도가 가장 좋은 후보입니다.`;
  } else if (unmet.length > 0) {
    headline = `${cond} — 점수는 ${rec.score}점이지만 일부 목표는 미달이 예상됩니다.`;
  } else {
    headline = `${cond} — 예상 ${GOAL_LABEL[primaryGoal]} ${fmtMetric(primaryGoal, rec.predicted_metric)} 수준의 후보입니다.`;
  }

  return { headline, reasons, risks, fulfillment };
}
