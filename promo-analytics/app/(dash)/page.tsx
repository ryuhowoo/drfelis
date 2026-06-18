import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type {
  Promotion,
  PromotionSummary,
  CampaignAchievement,
  PurposeMetric,
} from "@/lib/types";
import { won, wonShort, pct } from "@/lib/format";
import {
  MonthlyArea,
  Concentric,
  Donut,
  BaselineVsPromo,
  AchievementTrend,
  PurposeShareBars,
  PurposeFitBars,
  Spark,
} from "./DashCharts";

export const dynamic = "force-dynamic";

type Row = Promotion & {
  summary: PromotionSummary | null;
  baseline_daily: number;
  promo_daily: number;
  promo_days: number;
};

type OverallMetrics = {
  data_start: string;
  data_end: string;
  non_promo_days: number;
  promo_days: number;
  baseline_daily: number;
  promo_daily: number;
  lift_ratio: number | null;
};

// promo.all_campaign_features() 반환 행 (summary + measurement-파생)
type CampaignFeatureRow = PromotionSummary & {
  promotion_id: string;
  baseline_daily: number;
  actual_daily: number;
  qty_per_day: number;
  orders_per_day: number;
  duration_days: number;
};

// 0022 롤업 번들 — 사전 계산된 서빙 테이블에서 1회 왕복으로 읽는다
type DashboardBundle = {
  promotions: Promotion[];
  rollups: {
    promotion_id: string;
    features: CampaignFeatureRow | null;
    achievement: CampaignAchievement | null;
  }[];
  overall: OverallMetrics | null;
  purpose_metrics: PurposeMetric[];
  meta: { stale: boolean; refreshed_at: string | null } | null;
};

export default async function Dashboard() {
  const supabase = await createClient();
  const { data: bundleData } = await supabase.rpc("dashboard_bundle");
  const bundle = ((bundleData as DashboardBundle | null) ??
    {}) as Partial<DashboardBundle>;
  const stale = bundle.meta?.stale ?? false;
  const promos = bundle.promotions ?? [];
  const achData = (bundle.rollups ?? [])
    .map((r) => r.achievement)
    .filter((a): a is CampaignAchievement => a != null);
  const pmData = bundle.purpose_metrics ?? [];
  const featMap = new Map<string, CampaignFeatureRow>(
    (bundle.rollups ?? [])
      .filter((r) => r.features != null)
      .map((r) => [r.promotion_id, r.features as CampaignFeatureRow]),
  );

  const overall = bundle.overall ?? null;

  // 목적 슬라이스 (S5.2): 목적별 가중 기여매출/공헌 + 평균 적합도
  const pm = pmData;
  const purposeUplift = pm.map((p) => ({
    purpose: p.purpose,
    value: Number(p.weighted_uplift) || 0,
  }));
  const purposeContribution = pm.map((p) => ({
    purpose: p.purpose,
    value: Number(p.weighted_contribution) || 0,
  }));
  const purposeFit = pm.map((p) => ({
    purpose: p.purpose,
    score: p.avg_fit_score != null ? Number(p.avg_fit_score) : null,
    reliable: p.data_reliable,
  }));

  // 달성률 (S4): 확정 플랜 보유 캠페인만, 매출(expected_revenue_total) 가중평균
  const ach = achData;
  const withPlan = ach.filter((a) => a.has_confirmed_plan);
  const wAchRevenue = weightedAvg(
    withPlan.map((a) => ({ v: a.ach_revenue, w: a.expected_revenue_total })),
  );
  const wAchContribution = weightedAvg(
    withPlan.map((a) => ({ v: a.ach_contribution, w: a.expected_revenue_total })),
  );
  const achTrend = withPlan.map((a) => ({
    label: a.start_date.slice(2, 7).replace("-", "."),
    revenue: a.ach_revenue,
    contribution: a.ach_contribution,
  }));

  const rows: Row[] = promos.map((p: Promotion) => {
    const f = featMap.get(p.id);
    if (!f) {
      return { ...p, summary: null, baseline_daily: 0, promo_daily: 0, promo_days: 1 };
    }
    const promo_days = Number(f.promo_days) || 1;
    // summary 필드만 추려 PromotionSummary 형태로 — 0015 배치 RPC가 동일 출처
    const summary: PromotionSummary = {
      promo_days: Number(f.promo_days) || 0,
      direct_uplift: Number(f.direct_uplift) || 0,
      halo_uplift: Number(f.halo_uplift) || 0,
      total_uplift: Number(f.total_uplift) || 0,
      halo_share: f.halo_share != null ? Number(f.halo_share) : null,
      actual_revenue: Number(f.actual_revenue) || 0,
      contribution: Number(f.contribution) || 0,
      contribution_rate:
        f.contribution_rate != null ? Number(f.contribution_rate) : null,
      cold_start_count: Number(f.cold_start_count) || 0,
      trend_factor: Number(f.trend_factor) || 0,
      uplift_ci: Number(f.uplift_ci) || 0,
    };
    return {
      ...p,
      summary,
      baseline_daily: Number(f.baseline_daily) || 0,
      promo_daily: Number(f.actual_daily) || 0,
      promo_days,
    };
  });

  if (rows.length === 0) return <EmptyState />;

  const n = rows.length;
  const totalUplift = sum(rows.map((r) => r.summary?.total_uplift ?? 0));
  const totalDirect = sum(rows.map((r) => r.summary?.direct_uplift ?? 0));
  const totalHalo = sum(rows.map((r) => r.summary?.halo_uplift ?? 0));
  const avgDirect = n ? totalDirect / n : 0;
  const avgHalo = n ? totalHalo / n : 0;
  const haloShare = totalUplift !== 0 ? totalHalo / totalUplift : null;

  // 상시 일평균 vs 행사 일평균 — 데이터 기간 전체에서 일자 단위로 산출 (product 중복 합산 X)
  const totalBaselineDaily = overall?.baseline_daily ?? 0;
  const totalPromoDaily = overall?.promo_daily ?? 0;
  const liftRatio = overall?.lift_ratio ?? null;
  const compData = [...rows]
    .sort((a, b) => b.promo_daily - a.promo_daily)
    .slice(0, 5)
    .map((r) => ({
      name: r.name.replace(/^CF_P_\d+_?/, ""),
      baseline: r.baseline_daily,
      promo: r.promo_daily,
    }));

  const byMonth = new Map<string, number>();
  for (const r of rows) {
    const m = r.start_date.slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + (r.summary?.total_uplift ?? 0));
  }
  const monthly = [...byMonth.entries()]
    .map(([month, uplift]) => ({ month, uplift }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const trend =
    monthly.length >= 2 && monthly[monthly.length - 2].uplift !== 0
      ? (monthly[monthly.length - 1].uplift - monthly[monthly.length - 2].uplift) /
        Math.abs(monthly[monthly.length - 2].uplift)
      : null;

  const byType = new Map<string, number>();
  for (const r of rows) {
    const t = r.promo_type ?? "기타";
    byType.set(t, (byType.get(t) ?? 0) + (r.summary?.total_uplift ?? 0));
  }
  const typeData = [...byType.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const ranked = [...rows].sort(
    (a, b) => (b.summary?.total_uplift ?? 0) - (a.summary?.total_uplift ?? 0),
  );
  const best = ranked[0];

  const now = new Date();
  const dateChip = `${now.getMonth() + 1}월 ${now.getDate()}일`;

  // 인사이트 피드 (N6 R3.1): 룰 기반 페이싱·회고·예정 알림 — 제품이 먼저 말 걸기
  const todayStr = now.toISOString().slice(0, 10);
  const achByPromo = new Map(ach.map((a) => [a.promotion_id, a]));
  const dayDiff = (a: string, b: string) =>
    Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
  type Insight = {
    severity: "warn" | "ok" | "info";
    title: string;
    desc: string;
    href: string;
  };
  const insights: Insight[] = [];
  for (const r of rows) {
    const a = achByPromo.get(r.id);
    if (r.start_date <= todayStr && todayStr <= r.end_date) {
      // 진행 중: 기간 경과 대비 목표 매출 페이스
      const total = dayDiff(r.start_date, r.end_date) + 1;
      const elapsed = Math.min(total, dayDiff(r.start_date, todayStr) + 1);
      const elapsedRatio = total > 0 ? elapsed / total : 1;
      if (a?.has_confirmed_plan && a.ach_revenue != null && elapsedRatio > 0) {
        const pace = a.ach_revenue / elapsedRatio;
        insights.push({
          severity: pace < 0.85 ? "warn" : pace >= 1 ? "ok" : "info",
          title: `${r.name} — 진행 중 (${elapsed}/${total}일차)`,
          desc: `기간 ${Math.round(elapsedRatio * 100)}% 경과 · 목표 매출 ${Math.round(
            a.ach_revenue * 100,
          )}% 달성 — ${pace < 0.85 ? "페이스 부족, 점검 필요" : pace >= 1 ? "순항 중" : "근소하게 뒤처짐"}`,
          href: `/promotions/${r.id}`,
        });
      } else {
        insights.push({
          severity: "info",
          title: `${r.name} — 진행 중 (${elapsed}/${total}일차)`,
          desc: "확정 플랜이 없어 목표 페이싱을 추적할 수 없습니다. 플랜을 확정하세요.",
          href: `/promotions/${r.id}/plan`,
        });
      }
    } else if (r.end_date < todayStr && dayDiff(r.end_date, todayStr) <= 14) {
      // 최근 종료: 자동 회고
      if (a?.has_confirmed_plan && a.ach_revenue != null) {
        insights.push({
          severity: a.ach_revenue >= 1 ? "ok" : "warn",
          title: `${r.name} — ${dayDiff(r.end_date, todayStr)}일 전 종료`,
          desc: `최종 매출 달성률 ${Math.round(a.ach_revenue * 100)}% · 기여 매출 ${wonShort(
            r.summary?.total_uplift,
          )} — 회고 메모를 남겨두세요.`,
          href: `/promotions/${r.id}`,
        });
      } else if (r.summary) {
        insights.push({
          severity: "info",
          title: `${r.name} — ${dayDiff(r.end_date, todayStr)}일 전 종료`,
          desc: `기여 매출 ${wonShort(r.summary.total_uplift)} · 공헌이익 ${wonShort(
            r.summary.contribution,
          )} — 결과를 확인하세요.`,
          href: `/promotions/${r.id}`,
        });
      }
    } else if (r.start_date > todayStr && dayDiff(todayStr, r.start_date) <= 7) {
      insights.push({
        severity: "info",
        title: `${r.name} — D-${dayDiff(todayStr, r.start_date)} 시작 예정`,
        desc: "플랜·메인 상품·목적 가중치를 시작 전에 점검하세요.",
        href: `/promotions/${r.id}`,
      });
    }
  }
  const sevRank = { warn: 0, info: 1, ok: 2 } as const;
  insights.sort((x, y) => sevRank[x.severity] - sevRank[y.severity]);
  const topInsights = insights.slice(0, 6);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* 상단 바 */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 flex-col items-center justify-center rounded-2xl card-soft">
            <span className="text-base font-bold leading-none">{now.getDate()}</span>
          </div>
          <div>
            <div className="text-sm font-semibold text-ink">{dateChip}</div>
            <div className="text-xs text-ink-4">캠페인 {rows.length}건 분석 중</div>
          </div>
        </div>
        <Link
          href="/predict"
          className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:bg-brand-600 hover:shadow-float"
        >
          성과 시뮬레이터 →
        </Link>
      </header>

      {stale && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-2.5 text-xs text-amber-800">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
          방금 업로드·연동한 데이터로 분석을 갱신하는 중입니다. 아래 수치는 직전 기준이며
          1~2분 내 자동 반영됩니다.
        </div>
      )}

      {/* AI 인사이트 */}
      {best?.summary && (
        <section className="mb-5 rounded-2xl p-6 card-glass shimmer blob-soft rise-in">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[1.6px] text-brand-600">
            <span className="flex h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
            AI MD 인사이트
          </div>
          <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink-2">
            가장 효과적이었던 건{" "}
            <Link href={`/promotions/${best.id}`} className="font-semibold text-brand-600 hover:underline">
              {best.name}
            </Link>
            {" "}— 기여 매출 <strong className="text-ink">{won(best.summary.total_uplift)}</strong>
            {best.summary.halo_share != null && <>, 간접 비중 {pct(best.summary.halo_share)}</>}.
            {liftRatio != null && (
              <> 캠페인 기간엔 평소(상시 일평균)보다 <strong className="text-brand-600">{liftRatio.toFixed(1)}배</strong> 더 팔렸어요.</>
            )}
          </p>
        </section>
      )}

      {/* 인사이트 피드 (N6 R3.1): 진행 중 페이싱 · 최근 종료 회고 · 시작 예정 */}
      {topInsights.length > 0 && (
        <section className="mb-5 rounded-2xl card-soft p-5 rise-in">
          <h2 className="text-sm font-semibold text-ink-2">지금 주목할 것</h2>
          <ul className="mt-3 grid gap-2.5 lg:grid-cols-2 bento-in">
            {topInsights.map((it, i) => (
              <li key={i}>
                <Link
                  href={it.href}
                  className={`flex h-full items-start gap-2.5 rounded-xl border p-3 transition hover:shadow-sm ${
                    it.severity === "warn"
                      ? "border-amber-200 bg-amber-50/60"
                      : it.severity === "ok"
                        ? "border-emerald-200 bg-emerald-50/50"
                        : "border-line bg-soft/50"
                  }`}
                >
                  <span
                    className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                      it.severity === "warn"
                        ? "bg-amber-500"
                        : it.severity === "ok"
                          ? "bg-emerald-500"
                          : "bg-ink-4"
                    }`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-ink">
                      {it.title}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-ink-3">
                      {it.desc}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* KPI 타일 (N6 R2.1): 수치 + 전기간 대비 델타 + 스파크라인 + 클릭 드릴 */}
      <div className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-4 bento-in">
        <Kpi
          label="캠페인 기여 총 매출"
          value={wonShort(totalUplift)}
          full={won(totalUplift)}
          delta={trend}
          deltaLabel="전월 대비"
          spark={monthly.map((m) => ({ v: m.uplift }))}
          href="/library"
          brand
        />
        <Kpi
          label="매출 달성률 (플랜 가중)"
          value={wAchRevenue != null ? pct(wAchRevenue, 0) : "—"}
          delta={wAchRevenue != null ? wAchRevenue - 1 : null}
          deltaLabel="플랜 대비"
          spark={achTrend.map((a) => ({ v: a.revenue ?? 0 }))}
          href="/library"
        />
        <Kpi
          label="평소 대비 행사 매출"
          value={liftRatio != null ? `${liftRatio.toFixed(1)}배` : "—"}
          sub="상시 일평균 대비"
          href="/predict"
        />
        <Kpi
          label="간접 매출 비중"
          value={haloShare != null ? pct(haloShare, 0) : "—"}
          sub={`평균 직접 ${wonShort(avgDirect)} · 간접 ${wonShort(avgHalo)}`}
          href="/library"
        />
      </div>

      {/* 달성률 (계획 대비 실적) — S4 */}
      <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-5 lg:grid-cols-3 bento-in">
        <Card>
          <CardTitle>최근 캠페인 평균 달성률</CardTitle>
          {withPlan.length > 0 ? (
            <div className="space-y-3">
              <AchStat label="매출 달성률 (가중)" v={wAchRevenue} primary />
              <AchStat label="공헌이익 달성률 (가중)" v={wAchContribution} />
              <p className="text-xs text-ink-4">
                확정 플랜 {withPlan.length}건 기준 · 예상매출 가중평균
              </p>
            </div>
          ) : (
            <p className="py-6 text-sm text-ink-4">
              확정 플랜 데이터 없음 — 캠페인 플랜을 확정하면 달성률이 집계됩니다.
            </p>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardTitle>캠페인별 달성률 추세</CardTitle>
          <AchievementTrend data={achTrend} />
          <p className="mt-1 text-xs text-ink-4">
            <span className="text-brand-600">●</span> 매출 달성률{" "}
            <span className="ml-2 text-ink-2">●</span> 공헌이익 달성률 · 점선 = 100%(계획 달성)
          </p>
        </Card>
      </div>

      {/* 목적 슬라이스 (S5.2) */}
      {pm.length > 0 && (
        <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-5 lg:grid-cols-3 bento-in">
          <Card>
            <CardTitle>목적별 기여 매출 비중</CardTitle>
            <PurposeShareBars data={purposeUplift} />
          </Card>
          <Card>
            <CardTitle>목적별 공헌이익 비중</CardTitle>
            <PurposeShareBars data={purposeContribution} />
          </Card>
          <Card>
            <CardTitle>목적별 평균 적합도</CardTitle>
            <PurposeFitBars data={purposeFit} />
            <p className="mt-2 text-xs text-ink-4">
              같은 목적 캠페인 간 상대 점수(0~100) · 가중치는 캠페인 편집에서 조정
            </p>
          </Card>
        </div>
      )}

      {/* 상시 vs 행사 비교 (비교 기준) */}
      <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-5 lg:grid-cols-3 bento-in">
        <Card className="lg:col-span-2">
          <CardTitle>상시 대비 행사 일매출 (캠페인별)</CardTitle>
          <p className="-mt-2 mb-3 text-xs text-ink-4">
            <span className="font-medium text-ink-3">상시 일평균</span> = 캠페인 직전 8주의
            비캠페인 일평균 매출 · <span className="font-medium text-brand-600">행사 일평균</span> = 캠페인 기간 매출 ÷ 운영일수
            <span className="block">※ 그 캠페인에 등장한 상품들만 합산한 값 (전 매장 합계 아님)</span>
          </p>
          <BaselineVsPromo data={compData} />
        </Card>
        <div className="flex flex-col justify-center rounded-2xl p-5 card-soft blob-soft">
          <div className="text-[11px] font-bold uppercase tracking-[1.6px] text-ink-3">
            평소 대비 행사 매출 (전 매장)
          </div>
          <div className="mt-2 text-4xl font-bold tabular-nums text-brand-500 value-pop">
            {liftRatio != null ? `${liftRatio.toFixed(1)}배` : "—"}
          </div>
          <div className="mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-ink-3">상시 일평균</span>
              <span className="tabular-nums text-ink">{wonShort(totalBaselineDaily)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-3">행사 일평균</span>
              <span className="font-semibold tabular-nums text-brand-600">{wonShort(totalPromoDaily)}</span>
            </div>
          </div>
          {overall && (
            <div className="mt-3 text-[10px] text-ink-4">
              {overall.data_start} ~ {overall.data_end} · 비캠페인 {overall.non_promo_days}일 · 캠페인 {overall.promo_days}일
            </div>
          )}
        </div>
      </div>

      {/* 차트 Bento */}
      <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-5 lg:grid-cols-3 bento-in">
        <Card className="lg:col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <CardTitle className="mb-0">월별 증분 추세</CardTitle>
            {trend != null && (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold surface-pressed-soft ${
                  trend >= 0 ? "text-brand-600" : "text-ink-3"
                }`}
              >
                {trend >= 0 ? "▲" : "▼"} {pct(Math.abs(trend), 1)}
              </span>
            )}
          </div>
          <MonthlyArea data={monthly} />
        </Card>

        <div className="rounded-2xl p-5 card-soft">
          <h2 className="mb-3 text-sm font-semibold text-ink-2">전체 간접 매출 비중</h2>
          <Donut pct={haloShare} label="기타 제품 동반구매 기여" />
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-5 lg:grid-cols-3 bento-in">
        <Card>
          <CardTitle>혜택 유형별 증분</CardTitle>
          <Concentric data={typeData} />
        </Card>

        <Card className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <CardTitle className="mb-0">성과 랭킹</CardTitle>
            <Link href="/library" className="text-xs text-ink-4 hover:text-brand-600">
              전체 보기 →
            </Link>
          </div>
          <ul className="divide-y divide-[var(--color-line)]/60">
            {ranked.slice(0, 6).map((r, i) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    i === 0 ? "bg-brand-500 text-white" : "surface-pressed-soft text-ink-3"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/promotions/${r.id}`}
                    className="block truncate text-sm font-medium text-ink hover:text-brand-600"
                  >
                    {r.name}
                  </Link>
                  <div className="flex gap-1.5 text-xs text-ink-4">
                    <span>{r.start_date.slice(0, 7)}</span>
                    {r.promo_type && <span>· {r.promo_type}</span>}
                  </div>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums text-ink">
                  {wonShort(r.summary?.total_uplift)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function sum(a: number[]) {
  return a.reduce((x, y) => x + y, 0);
}

// 금액 가중평균 (v=비율, w=가중치). 유효한(v·w 모두 존재, w>0) 항목만.
function weightedAvg(
  items: { v: number | null; w: number | null }[],
): number | null {
  let num = 0;
  let den = 0;
  for (const { v, w } of items) {
    if (v == null || w == null || w <= 0) continue;
    num += v * w;
    den += w;
  }
  return den > 0 ? num / den : null;
}

function AchStat({
  label,
  v,
  primary,
}: {
  label: string;
  v: number | null;
  primary?: boolean;
}) {
  const color =
    v == null
      ? "text-ink-4"
      : v >= 1
        ? "text-brand-600"
        : v < 0.7
          ? "text-brand-700"
          : "text-ink";
  return (
    <div>
      <div className="text-xs text-ink-4">{label}</div>
      <div className={`mt-0.5 font-bold tabular-nums ${primary ? "text-3xl" : "text-2xl"} ${color}`}>
        {v != null ? pct(v, 0) : "—"}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  full,
  brand,
  delta,
  deltaLabel,
  spark,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  full?: string; // 데스크톱에서 풀 표기 (예: ₩3,409,316,915)
  brand?: boolean;
  delta?: number | null; // 비율 (예: 0.12 = +12%)
  deltaLabel?: string;
  spark?: { v: number }[];
  href?: string;
}) {
  const body = (
    <div
      className={`flex h-full flex-col rounded-2xl p-4 transition duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] sm:p-5 ${
        brand
          ? "bg-brand-500 text-white shadow-float blob-bright hover:-translate-y-0.5"
          : "card-soft hover:card-soft-h"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={`text-[11px] font-bold uppercase tracking-[1.4px] ${brand ? "text-brand-100" : "text-ink-3"}`}>{label}</div>
        {delta != null && Number.isFinite(delta) && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              brand
                ? "bg-white/15 text-white"
                : delta >= 0
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-red-50 text-red-600"
            }`}
            title={deltaLabel}
          >
            {delta >= 0 ? "▲" : "▼"} {pct(Math.abs(delta), 0)}
          </span>
        )}
      </div>
      <div className="mt-2 break-words text-lg font-bold tracking-tight tabular-nums sm:text-2xl">
        <span className={full ? "sm:hidden" : ""}>{value}</span>
        {full && <span className="hidden sm:inline">{full}</span>}
      </div>
      {sub && <div className={`mt-0.5 text-[11px] ${brand ? "text-brand-100" : "text-ink-4"}`}>{sub}</div>}
      {spark && spark.length > 1 && (
        <div className="mt-auto pt-2">
          <Spark data={spark} color={brand ? "#ffffff" : "#14916a"} />
        </div>
      )}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl p-5 card-soft ${className}`}>{children}</div>;
}

function CardTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`mb-3 text-sm font-semibold text-ink-2 ${className}`}>{children}</h2>;
}

function EmptyState() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto mt-6 max-w-lg rounded-2xl p-8 text-center card-soft">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500 text-xl text-white">
          ✦
        </div>
        <p className="text-base font-semibold text-ink">아직 데이터가 없습니다.</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-3">
          첨부해주신 마스터·일별 매출·캠페인 데이터를 버튼 한 번으로 적재할 수 있어요.
        </p>
        <Link
          href="/seed"
          className="mt-5 inline-block rounded-full bg-brand-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-600"
        >
          초기 데이터 적재하기 →
        </Link>
      </div>
    </div>
  );
}
