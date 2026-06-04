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
};

export type PredictionSpec = {
  promo_type?: string | null;
  season_tag?: string | null;
  discount_rate?: number | null; // 0~1
  duration_days: number;
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
  expected_contribution: number; // 예상 공헌이익(기간)
  confidence: "높음" | "보통" | "낮음";
  confidence_score: number; // 0~1
  comparables: Comparable[];
  rationale: string;
};

function wavg(items: Comparable[], pick: (c: Comparable) => number | null): number {
  let s = 0, w = 0;
  for (const c of items) {
    const v = pick(c);
    if (v == null) continue;
    s += v * c.score;
    w += c.score;
  }
  return w > 0 ? s / w : 0;
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

export function predict(spec: PredictionSpec, cases: CaseFeature[]): Prediction {
  const scored: Comparable[] = cases
    .map((c) => ({ ...c, score: similarity(spec, c) }))
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
    const cr = mean((c) => c.contribution_rate);
    const expected = avgPerDay * spec.duration_days;
    return {
      expected_uplift: expected,
      low: expected * 0.5,
      high: expected * 1.5,
      expected_uplift_per_day: avgPerDay,
      expected_baseline_daily: baseDaily,
      expected_promo_daily: promoDaily,
      lift_ratio: baseDaily > 0 ? promoDaily / baseDaily : null,
      expected_contribution_rate: cr || null,
      expected_contribution: promoDaily * spec.duration_days * cr,
      confidence: "낮음",
      confidence_score: 0.2,
      comparables: [],
      rationale:
        "유사한 과거 사례가 부족해 전체 평균으로 추정했습니다. 사례가 쌓일수록 정확해집니다.",
    };
  }

  // 유사도 가중 평균 일평균 증분
  const wSum = top.reduce((s, c) => s + c.score, 0);
  const perDay = top.reduce((s, c) => s + c.uplift_per_day * c.score, 0) / wSum;
  const expected = perDay * spec.duration_days;

  // 분산 → 범위
  const perDays = top.map((c) => c.uplift_per_day);
  const min = Math.min(...perDays) * spec.duration_days;
  const max = Math.max(...perDays) * spec.duration_days;

  // 신뢰도: 사례 수 + 평균 유사도
  const avgScore = wSum / top.length;
  const cScore = Math.min(1, (top.length / 5) * 0.5 + avgScore * 0.5);
  const confidence: Prediction["confidence"] =
    cScore >= 0.66 ? "높음" : cScore >= 0.4 ? "보통" : "낮음";

  const baseDaily = wavg(top, (c) => c.baseline_daily);
  const promoDaily = baseDaily + perDay;
  const cr = wavg(top, (c) => c.contribution_rate);

  return {
    expected_uplift: expected,
    low: Math.min(min, expected),
    high: Math.max(max, expected),
    expected_uplift_per_day: perDay,
    expected_baseline_daily: baseDaily,
    expected_promo_daily: promoDaily,
    lift_ratio: baseDaily > 0 ? promoDaily / baseDaily : null,
    expected_contribution_rate: cr || null,
    expected_contribution: promoDaily * spec.duration_days * cr,
    confidence,
    confidence_score: cScore,
    comparables: top,
    rationale: `유사 사례 ${top.length}건(평균 유사도 ${(avgScore * 100).toFixed(
      0,
    )}%)의 일평균 증분을 가중 평균해 ${spec.duration_days}일로 환산했습니다.`,
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

// ── 목적 기반 추천 (매출/재고소진/브랜딩) + 종합점수 ──
export type Goal = "revenue" | "stock" | "branding";

export type GoalRec = {
  promo_type: string;
  discount_rate: number | null;
  metric_per_day: number; // 목적 지표 일평균
  predicted_metric: number; // 기간 환산 목적 지표
  predicted_uplift: number;
  predicted_contribution: number;
  contribution_rate: number | null;
  score: number; // 종합 점수 0~100
  confidence: "높음" | "보통" | "낮음";
  sample: number;
  meets_target: boolean;
  examples: { id: string; name: string }[];
};

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
    sample: number;
    examples: { id: string; name: string }[];
  };
  const raws: Raw[] = [];
  for (const [key, g] of buckets) {
    const [promo_type, bucketStr] = key.split("|");
    const bucket = Number(bucketStr);
    const avg = (pick: (c: CaseFeature) => number) =>
      g.reduce((s, c) => s + pick(c), 0) / g.length;
    const dr = bucket >= 0 ? bucket / 100 : null;
    const uplift_per_day = avg((c) => c.uplift_per_day);
    const crs = g.map((c) => c.contribution_rate).filter((x): x is number => x != null);
    const cr = crs.length ? crs.reduce((a, b) => a + b, 0) / crs.length : null;
    raws.push({
      promo_type,
      discount_rate: dr,
      metric_per_day: avg((c) => goalPerDay(goal, c)),
      uplift_per_day,
      contribution_per_day: avg((c) => (c.duration_days > 0 ? c.contribution / c.duration_days : 0)),
      contribution_rate: cr,
      efficiency: dr && dr > 0 ? uplift_per_day / dr : uplift_per_day,
      halo_share: avg((c) => c.halo_share ?? 0),
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
    // 종합 점수: 공헌이익 40 · 증분 30 · 효율 20 · 후광 10
    const score =
      (0.4 * (r.contribution_per_day / mC) +
        0.3 * (r.uplift_per_day / mU) +
        0.2 * (r.efficiency / mE) +
        0.1 * Math.min(1, r.halo_share)) *
      100;
    const predicted_metric = r.metric_per_day * durationDays;
    const cScore = Math.min(1, r.sample / 5);
    return {
      promo_type: r.promo_type,
      discount_rate: r.discount_rate,
      metric_per_day: r.metric_per_day,
      predicted_metric,
      predicted_uplift: r.uplift_per_day * durationDays,
      predicted_contribution: r.contribution_per_day * durationDays,
      contribution_rate: r.contribution_rate,
      score: Math.round(score),
      confidence: cScore >= 0.66 ? "높음" : cScore >= 0.4 ? "보통" : "낮음",
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
