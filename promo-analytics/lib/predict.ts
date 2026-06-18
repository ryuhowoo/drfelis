// Phase 2/3 공통 — 규칙/통계 기반 비교 사례 엔진 (방식 A)
// 데이터가 적어도 답을 내되, 신뢰도(confidence)를 함께 반환한다.

export type CaseFeature = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  promo_type: string | null;
  season_tag: string | null;
  discount_rate: number | null; // 0~1
  duration_days: number;
  uplift_per_day: number;
  total_uplift: number;
  contribution: number;
  contribution_rate: number | null;
  halo_share: number | null;
  baseline_daily: number; // 상시 일평균(전 제품 합)
  actual_daily: number; // 행사 기간 일평균
  qty_per_day: number; // 일평균 판매수량
  orders_per_day: number; // 일평균 구매건수
  purposes: { purpose: string; weight: number }[]; // 유효 목적 가중 (S5)
  // 달성률 패턴 (S6) — campaign_achievements/plan_vs_actual 단일 출처
  ach_revenue: number | null; // 계획 대비 실적 매출 비율 (1.0=계획대로)
  ach_contribution: number | null; // 계획 대비 실적 공헌 비율
  has_confirmed_plan: boolean;
  reliability: number; // 0~1 달성 신뢰도 = f(|1−ach_revenue|, 확정 플랜)
};

export type PredictionSpec = {
  promo_type?: string | null;
  season_tag?: string | null;
  discount_rate?: number | null; // 0~1
  duration_days: number;
  purpose?: string | null; // 목적 선택 (S5) — 같은 목적 사례 우선 가중
};

export type Comparable = CaseFeature & { score: number };

export type Prediction = {
  expected_uplift: number; // 예상 총 증분
  low: number;
  high: number;
  expected_uplift_per_day: number;
  expected_baseline_daily: number; // 상시 일평균(예상)
  expected_promo_daily: number; // 행사 일평균(예상)
  lift_ratio: number | null; // 평소 대비 배수
  expected_contribution_rate: number | null; // 예상 공헌이익률
  expected_uplift_contribution: number | null; // 증분(기여) 공헌이익 = 증분일평균×일수×율
  expected_total_contribution: number | null; // 전체 예상 공헌이익 = 행사일평균×일수×율 (baseline 포함)
  confidence: "높음" | "보통" | "낮음";
  confidence_score: number; // 0~1
  comparables: Comparable[];
  rationale: string;
};

// 유사도 × 달성 신뢰도(S6)로 가중. 계획을 잘 맞춘 사례가 예측을 더 끈다.
function caseWeight(c: Comparable): number {
  return c.score * (c.reliability ?? 1);
}

// 추천 버킷용 — 달성 신뢰도 평균/편차 (S6.3 일관성 랭킹)
function bucketReliability(g: CaseFeature[]): { mean: number; stdev: number } {
  const rels = g.map((c) => c.reliability ?? 0.5);
  const mean = rels.reduce((a, b) => a + b, 0) / rels.length;
  const stdev = Math.sqrt(
    rels.reduce((s, r) => s + (r - mean) ** 2, 0) / rels.length,
  );
  return { mean, stdev };
}

// reliability 가중 평균 — 잘 맞춘 사례가 버킷 예측치를 더 끌도록
function ravg(g: CaseFeature[], pick: (c: CaseFeature) => number): number {
  let s = 0,
    w = 0;
  for (const c of g) {
    const rel = c.reliability ?? 0.5;
    s += pick(c) * rel;
    w += rel;
  }
  return w > 0 ? s / w : 0;
}

// 달성 일관성 보정: 평균 신뢰도↑·편차↓일수록 점수/신뢰도를 끌어올린다.
function consistencyFactor(mean: number, stdev: number): number {
  return (0.7 + 0.3 * mean) * (1 - Math.min(0.3, stdev));
}

function wavg(items: Comparable[], pick: (c: Comparable) => number | null): number {
  let s = 0, w = 0;
  for (const c of items) {
    const v = pick(c);
    if (v == null) continue;
    const cw = caseWeight(c);
    s += v * cw;
    w += cw;
  }
  return w > 0 ? s / w : 0;
}

// null 보존 가중평균 — 유효값이 하나도 없으면 0이 아니라 null('데이터 부족')을 반환.
function wavgN(items: Comparable[], pick: (c: Comparable) => number | null): number | null {
  let s = 0, w = 0, any = false;
  for (const c of items) {
    const v = pick(c);
    if (v == null) continue;
    any = true;
    const cw = caseWeight(c);
    s += v * cw;
    w += cw;
  }
  return any && w > 0 ? s / w : null;
}

// 두 케이스/스펙의 유사도 (0~1)
export function similarity(spec: PredictionSpec, c: CaseFeature): number {
  let score = 0;
  let weight = 0;

  // 혜택 종류 (0.30)
  weight += 0.3;
  if (spec.promo_type && c.promo_type)
    score += spec.promo_type === c.promo_type ? 0.3 : 0;

  // 시즌/시점 (0.30)
  weight += 0.3;
  if (spec.season_tag && c.season_tag)
    score += spec.season_tag === c.season_tag ? 0.3 : 0;

  // 할인율 근접도 (0.25)
  weight += 0.25;
  if (spec.discount_rate != null && c.discount_rate != null) {
    const diff = Math.abs(spec.discount_rate - c.discount_rate);
    score += 0.25 * Math.max(0, 1 - diff / 0.5); // 50%p 차이면 0점
  }

  // 기간 근접도 (0.15)
  weight += 0.15;
  const dd = Math.abs(spec.duration_days - c.duration_days);
  score += 0.15 * Math.max(0, 1 - dd / 14); // 14일 차이면 0점

  return weight > 0 ? score / weight : 0;
}

// 목적 선택 시 같은 목적 사례를 우선 가중 (제외가 아닌 우선순위 — 콜드스타트 대비).
// effective_weight 1.0 → ×1.0, 0 → ×0.4.
function purposeFactor(spec: PredictionSpec, c: CaseFeature): number {
  if (!spec.purpose) return 1;
  const pw = c.purposes?.find((p) => p.purpose === spec.purpose)?.weight ?? 0;
  return 0.4 + 0.6 * Math.min(1, Math.max(0, pw));
}

export function predict(spec: PredictionSpec, cases: CaseFeature[]): Prediction {
  const scored: Comparable[] = cases
    .map((c) => ({ ...c, score: similarity(spec, c) * purposeFactor(spec, c) }))
    .filter((c) => c.score > 0.15 && c.uplift_per_day !== 0)
    .sort((a, b) => b.score - a.score);

  const top = scored.slice(0, 6);

  if (top.length === 0) {
    // 콜드스타트: 전체 평균으로 fallback
    const valid = cases.filter((c) => c.uplift_per_day !== 0);
    const mean = (pick: (c: CaseFeature) => number | null) => {
      const xs = valid.map(pick).filter((x): x is number => x != null);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    };
    const avgPerDay = mean((c) => c.uplift_per_day);
    const baseDaily = mean((c) => c.baseline_daily);
    const promoDaily = baseDaily + avgPerDay;
    // 공헌율은 null 보존 — 유효 사례가 없으면 '데이터 부족'(null)
    const crVals = valid
      .map((c) => c.contribution_rate)
      .filter((x): x is number => x != null);
    const cr = crVals.length ? crVals.reduce((a, b) => a + b, 0) / crVals.length : null;
    const expected = avgPerDay * spec.duration_days;
    return {
      expected_uplift: expected,
      low: expected * 0.5,
      high: expected * 1.5,
      expected_uplift_per_day: avgPerDay,
      expected_baseline_daily: baseDaily,
      expected_promo_daily: promoDaily,
      lift_ratio: baseDaily > 0 ? promoDaily / baseDaily : null,
      expected_contribution_rate: cr,
      expected_uplift_contribution: cr != null ? avgPerDay * spec.duration_days * cr : null,
      expected_total_contribution: cr != null ? promoDaily * spec.duration_days * cr : null,
      confidence: "낮음",
      confidence_score: 0.2,
      comparables: [],
      rationale:
        "유사한 과거 사례가 부족해 전체 평균으로 추정했습니다. 사례가 쌓일수록 정확해집니다.",
    };
  }

  // 유사도 × 달성 신뢰도(S6) 가중 평균 일평균 증분
  const ewSum = top.reduce((s, c) => s + caseWeight(c), 0);
  const perDay =
    ewSum > 0
      ? top.reduce((s, c) => s + c.uplift_per_day * caseWeight(c), 0) / ewSum
      : 0;
  const expected = perDay * spec.duration_days;

  // 분산 → 범위
  const perDays = top.map((c) => c.uplift_per_day);
  const min = Math.min(...perDays) * spec.duration_days;
  const max = Math.max(...perDays) * spec.duration_days;

  // 신뢰도: 사례 수 + 평균 유사도 + 평균 달성 신뢰도, 달성 분산 크면 ↓ (S6)
  const wSum = top.reduce((s, c) => s + c.score, 0);
  const avgScore = wSum / top.length;
  const meanRel = top.reduce((s, c) => s + c.reliability, 0) / top.length;
  const relStdev = Math.sqrt(
    top.reduce((s, c) => s + (c.reliability - meanRel) ** 2, 0) / top.length,
  );
  const cScore =
    Math.min(1, (top.length / 5) * 0.4 + avgScore * 0.35 + meanRel * 0.25) *
    (1 - Math.min(0.35, relStdev)); // 달성 분산 패널티
  const confidence: Prediction["confidence"] =
    cScore >= 0.66 ? "높음" : cScore >= 0.4 ? "보통" : "낮음";

  const baseDaily = wavg(top, (c) => c.baseline_daily);
  const promoDaily = baseDaily + perDay;
  const cr = wavgN(top, (c) => c.contribution_rate);

  return {
    expected_uplift: expected,
    low: Math.min(min, expected),
    high: Math.max(max, expected),
    expected_uplift_per_day: perDay,
    expected_baseline_daily: baseDaily,
    expected_promo_daily: promoDaily,
    lift_ratio: baseDaily > 0 ? promoDaily / baseDaily : null,
    expected_contribution_rate: cr,
    expected_uplift_contribution: cr != null ? perDay * spec.duration_days * cr : null,
    expected_total_contribution: cr != null ? promoDaily * spec.duration_days * cr : null,
    confidence,
    confidence_score: cScore,
    comparables: top,
    rationale:
      `유사 사례 ${top.length}건(평균 유사도 ${(avgScore * 100).toFixed(0)}%)의 일평균 증분을 가중 평균해 ${spec.duration_days}일로 환산했습니다.` +
      (spec.purpose ? ` ‘${spec.purpose}’ 목적 사례를 우선 가중했습니다.` : "") +
      ` 계획을 잘 맞춘 캠페인(달성 신뢰도 평균 ${(meanRel * 100).toFixed(0)}%)에 가중치를 더 줬습니다.` +
      (relStdev > 0.25 ? " 다만 사례 간 달성 편차가 커 신뢰도를 낮췄습니다." : ""),
  };
}

// Phase 3 — 처방: 목표 증분을 맞추는 혜택 구성 추천
export type Recommendation = {
  promo_type: string;
  season_tag: string | null;
  discount_rate: number | null;
  predicted_uplift: number;
  confidence: Prediction["confidence"];
  avg_contribution_rate: number | null;
  sample: number;
  meets_target: boolean;
};

// ── 목적 기반 추천 (세일즈/재고소진/브랜딩) + 종합점수 ──
export type Goal = "revenue" | "stock" | "branding";

export type GoalRec = {
  promo_type: string;
  discount_rate: number | null;
  metric_per_day: number; // 목적 지표 일평균
  predicted_metric: number; // 기간 환산 목적 지표
  predicted_uplift: number;
  predicted_uplift_contribution: number | null; // 증분(기여) 공헌 = 증분일평균×율×일수
  predicted_total_contribution: number | null; // 전체 예상 공헌 = 공헌일평균×일수 (baseline 포함)
  contribution_rate: number | null;
  score: number; // 종합 점수 0~100
  confidence: "높음" | "보통" | "낮음";
  reliability: number; // 0~1 버킷 평균 달성 신뢰도 (S6)
  sample: number;
  meets_target: boolean;
  examples: { id: string; name: string }[];
  // 멀티 목표일 때 각 목표별 예측치/달성 여부
  per_goal?: {
    goal: Goal;
    metric_per_day: number;
    predicted_metric: number;
    target: number;
    meets_target: boolean;
  }[];
};

// 멀티 목표 입력
export type GoalTarget = { goal: Goal; target: number };

function goalPerDay(goal: Goal, c: CaseFeature): number {
  if (goal === "stock") return c.qty_per_day;
  if (goal === "branding") return c.orders_per_day;
  return c.uplift_per_day; // revenue
}

export function recommendByGoal(
  goal: Goal,
  target: number,
  durationDays: number,
  seasonTag: string | null,
  cases: CaseFeature[],
): GoalRec[] {
  const buckets = new Map<string, CaseFeature[]>();
  for (const c of cases) {
    if (!c.promo_type) continue;
    if (seasonTag && c.season_tag && c.season_tag !== seasonTag) continue;
    const bucket =
      c.discount_rate != null ? Math.round((c.discount_rate * 100) / 10) * 10 : -1;
    const key = `${c.promo_type}|${bucket}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(c);
  }

  type Raw = {
    promo_type: string;
    discount_rate: number | null;
    metric_per_day: number;
    uplift_per_day: number;
    contribution_per_day: number;
    contribution_rate: number | null;
    efficiency: number; // 증분/할인깊이
    halo_share: number;
    reliability: number; // 버킷 평균 달성 신뢰도
    rel_stdev: number;
    sample: number;
    examples: { id: string; name: string }[];
  };
  const raws: Raw[] = [];
  for (const [key, g] of buckets) {
    const [promo_type, bucketStr] = key.split("|");
    const bucket = Number(bucketStr);
    const dr = bucket >= 0 ? bucket / 100 : null;
    const uplift_per_day = ravg(g, (c) => c.uplift_per_day); // reliability 가중
    const crs = g.map((c) => c.contribution_rate).filter((x): x is number => x != null);
    const cr = crs.length ? crs.reduce((a, b) => a + b, 0) / crs.length : null;
    const rel = bucketReliability(g);
    raws.push({
      promo_type,
      discount_rate: dr,
      metric_per_day: ravg(g, (c) => goalPerDay(goal, c)),
      uplift_per_day,
      contribution_per_day: ravg(g, (c) => (c.duration_days > 0 ? c.contribution / c.duration_days : 0)),
      contribution_rate: cr,
      efficiency: dr && dr > 0 ? uplift_per_day / dr : uplift_per_day,
      halo_share: ravg(g, (c) => c.halo_share ?? 0),
      reliability: rel.mean,
      rel_stdev: rel.stdev,
      sample: g.length,
      examples: g.slice(0, 3).map((c) => ({ id: c.id, name: c.name })),
    });
  }

  // 정규화용 최대값
  const maxOf = (pick: (r: Raw) => number) => Math.max(...raws.map(pick), 1e-9);
  const mU = maxOf((r) => r.uplift_per_day);
  const mC = maxOf((r) => r.contribution_per_day);
  const mE = maxOf((r) => r.efficiency);

  const recs: GoalRec[] = raws.map((r) => {
    // 종합 점수: 공헌이익 40 · 증분 30 · 효율 20 · 후광 10, 달성 일관성 보정(S6.3)
    const score =
      (0.4 * (r.contribution_per_day / mC) +
        0.3 * (r.uplift_per_day / mU) +
        0.2 * (r.efficiency / mE) +
        0.1 * Math.min(1, r.halo_share)) *
      consistencyFactor(r.reliability, r.rel_stdev) *
      100;
    const predicted_metric = r.metric_per_day * durationDays;
    const cScore =
      Math.min(1, (r.sample / 5) * 0.7 + r.reliability * 0.3) *
      (1 - Math.min(0.3, r.rel_stdev));
    return {
      promo_type: r.promo_type,
      discount_rate: r.discount_rate,
      metric_per_day: r.metric_per_day,
      predicted_metric,
      predicted_uplift: r.uplift_per_day * durationDays,
      predicted_uplift_contribution:
        r.contribution_rate != null ? r.uplift_per_day * r.contribution_rate * durationDays : null,
      predicted_total_contribution:
        r.contribution_rate != null ? r.contribution_per_day * durationDays : null,
      contribution_rate: r.contribution_rate,
      score: Math.round(score),
      confidence: cScore >= 0.66 ? "높음" : cScore >= 0.4 ? "보통" : "낮음",
      reliability: r.reliability,
      sample: r.sample,
      meets_target: predicted_metric >= target,
      examples: r.examples,
    };
  });

  return recs.sort((a, b) => {
    if (a.meets_target !== b.meets_target) return a.meets_target ? -1 : 1;
    return b.score - a.score;
  });
}

// 멀티 목표(브랜딩+세일즈 등) 동시 추천: 각 목표별 점수를 동일 가중 평균.
// 목표마다 별도 target을 받아 per_goal에서 달성 여부를 함께 반환.
export function recommendByGoals(
  goalTargets: GoalTarget[],
  durationDays: number,
  seasonTag: string | null,
  cases: CaseFeature[],
): GoalRec[] {
  if (goalTargets.length === 0) return [];
  if (goalTargets.length === 1) {
    const { goal, target } = goalTargets[0];
    return recommendByGoal(goal, target, durationDays, seasonTag, cases);
  }

  const buckets = new Map<string, CaseFeature[]>();
  for (const c of cases) {
    if (!c.promo_type) continue;
    if (seasonTag && c.season_tag && c.season_tag !== seasonTag) continue;
    const bucket =
      c.discount_rate != null ? Math.round((c.discount_rate * 100) / 10) * 10 : -1;
    const key = `${c.promo_type}|${bucket}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(c);
  }

  type Raw = {
    promo_type: string;
    discount_rate: number | null;
    metrics: Map<Goal, number>; // 목적별 일평균 지표
    uplift_per_day: number;
    contribution_per_day: number;
    contribution_rate: number | null;
    efficiency: number;
    halo_share: number;
    reliability: number; // 버킷 평균 달성 신뢰도
    rel_stdev: number;
    sample: number;
    examples: { id: string; name: string }[];
  };
  const raws: Raw[] = [];
  for (const [key, g] of buckets) {
    const [promo_type, bucketStr] = key.split("|");
    const bucket = Number(bucketStr);
    const dr = bucket >= 0 ? bucket / 100 : null;
    const uplift_per_day = ravg(g, (c) => c.uplift_per_day); // reliability 가중
    const crs = g.map((c) => c.contribution_rate).filter((x): x is number => x != null);
    const cr = crs.length ? crs.reduce((a, b) => a + b, 0) / crs.length : null;
    const rel = bucketReliability(g);
    const metrics = new Map<Goal, number>();
    metrics.set("revenue", uplift_per_day);
    metrics.set("stock", ravg(g, (c) => c.qty_per_day));
    metrics.set("branding", ravg(g, (c) => c.orders_per_day));
    raws.push({
      promo_type,
      discount_rate: dr,
      metrics,
      uplift_per_day,
      contribution_per_day: ravg(g, (c) => (c.duration_days > 0 ? c.contribution / c.duration_days : 0)),
      contribution_rate: cr,
      efficiency: dr && dr > 0 ? uplift_per_day / dr : uplift_per_day,
      halo_share: ravg(g, (c) => c.halo_share ?? 0),
      reliability: rel.mean,
      rel_stdev: rel.stdev,
      sample: g.length,
      examples: g.slice(0, 3).map((c) => ({ id: c.id, name: c.name })),
    });
  }

  const maxOf = (pick: (r: Raw) => number) => Math.max(...raws.map(pick), 1e-9);
  const mU = maxOf((r) => r.uplift_per_day);
  const mC = maxOf((r) => r.contribution_per_day);
  const mE = maxOf((r) => r.efficiency);
  // 목적별 정규화용 최대값
  const mMetric = new Map<Goal, number>();
  for (const gt of goalTargets) {
    mMetric.set(gt.goal, maxOf((r) => r.metrics.get(gt.goal) ?? 0));
  }

  const recs: GoalRec[] = raws.map((r) => {
    // 단일 목표 점수: 공헌이익40·증분30·효율20·후광10 (기존 가중치)
    // 멀티 목표 점수: 위 점수 + 선택한 목적별 정규화 metric 평균 점수
    //                선택한 목적 비중을 절반 정도 반영(과도한 편향 방지)
    const baseScore =
      0.4 * (r.contribution_per_day / mC) +
      0.3 * (r.uplift_per_day / mU) +
      0.2 * (r.efficiency / mE) +
      0.1 * Math.min(1, r.halo_share);
    const goalScore =
      goalTargets.reduce((s, gt) => {
        const m = r.metrics.get(gt.goal) ?? 0;
        const max = mMetric.get(gt.goal) ?? 1e-9;
        return s + m / max;
      }, 0) / goalTargets.length;
    const score =
      (baseScore * 0.5 + goalScore * 0.5) *
      consistencyFactor(r.reliability, r.rel_stdev) * // 달성 일관성 보정(S6.3)
      100;

    const per_goal = goalTargets.map((gt) => {
      const metricPerDay = r.metrics.get(gt.goal) ?? 0;
      const predictedMetric = metricPerDay * durationDays;
      return {
        goal: gt.goal,
        metric_per_day: metricPerDay,
        predicted_metric: predictedMetric,
        target: gt.target,
        meets_target: gt.target > 0 ? predictedMetric >= gt.target : true,
      };
    });
    const meetsAll = per_goal.every((p) => p.meets_target);

    const cScore =
      Math.min(1, (r.sample / 5) * 0.7 + r.reliability * 0.3) *
      (1 - Math.min(0.3, r.rel_stdev));
    // GoalRec의 단일 metric 필드는 첫 목표 기준으로 채움(하위 호환).
    const primary = per_goal[0];
    return {
      promo_type: r.promo_type,
      discount_rate: r.discount_rate,
      metric_per_day: primary.metric_per_day,
      predicted_metric: primary.predicted_metric,
      predicted_uplift: r.uplift_per_day * durationDays,
      predicted_uplift_contribution:
        r.contribution_rate != null ? r.uplift_per_day * r.contribution_rate * durationDays : null,
      predicted_total_contribution:
        r.contribution_rate != null ? r.contribution_per_day * durationDays : null,
      contribution_rate: r.contribution_rate,
      score: Math.round(score),
      confidence: cScore >= 0.66 ? "높음" : cScore >= 0.4 ? "보통" : "낮음",
      reliability: r.reliability,
      sample: r.sample,
      meets_target: meetsAll,
      examples: r.examples,
      per_goal,
    };
  });

  return recs.sort((a, b) => {
    if (a.meets_target !== b.meets_target) return a.meets_target ? -1 : 1;
    return b.score - a.score;
  });
}

export function prescribe(
  targetUplift: number,
  durationDays: number,
  seasonTag: string | null,
  cases: CaseFeature[],
): Recommendation[] {
  // (혜택종류 × 할인율 버킷)으로 그룹화
  const buckets = new Map<string, CaseFeature[]>();
  for (const c of cases) {
    if (!c.promo_type || c.uplift_per_day === 0) continue;
    if (seasonTag && c.season_tag && c.season_tag !== seasonTag) continue;
    const bucket =
      c.discount_rate != null ? Math.round(c.discount_rate * 100 / 10) * 10 : -1;
    const key = `${c.promo_type}|${bucket}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(c);
  }

  const recs: Recommendation[] = [];
  for (const [key, group] of buckets) {
    const [promo_type, bucketStr] = key.split("|");
    const bucket = Number(bucketStr);
    const avgPerDay =
      group.reduce((s, c) => s + c.uplift_per_day, 0) / group.length;
    const predicted = avgPerDay * durationDays;
    const crs = group
      .map((c) => c.contribution_rate)
      .filter((x): x is number => x != null);
    const avgCR = crs.length ? crs.reduce((a, b) => a + b, 0) / crs.length : null;
    const cScore = Math.min(1, group.length / 5);

    recs.push({
      promo_type,
      season_tag: seasonTag,
      discount_rate: bucket >= 0 ? bucket / 100 : null,
      predicted_uplift: predicted,
      confidence: cScore >= 0.66 ? "높음" : cScore >= 0.4 ? "보통" : "낮음",
      avg_contribution_rate: avgCR,
      sample: group.length,
      meets_target: predicted >= targetUplift,
    });
  }

  // 목표 달성 우선 → 공헌이익률 → 예상 증분 순
  return recs.sort((a, b) => {
    if (a.meets_target !== b.meets_target) return a.meets_target ? -1 : 1;
    const cr = (b.avg_contribution_rate ?? 0) - (a.avg_contribution_rate ?? 0);
    if (Math.abs(cr) > 0.001) return cr;
    return b.predicted_uplift - a.predicted_uplift;
  });
}
