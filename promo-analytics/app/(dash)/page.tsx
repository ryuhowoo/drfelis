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

export default async function Dashboard() {
  const supabase = await createClient();
  const [
    { data: promos },
    { data: overallData },
    { data: achData },
    { data: pmData },
    { data: featData },
  ] = await Promise.all([
    supabase.from("promotions").select("*").order("start_date", { ascending: false }),
    supabase.rpc("overall_baseline_metrics"),
    supabase.rpc("campaign_achievements"),
    supabase.rpc("purpose_metrics"),
    supabase.rpc("all_campaign_features"),
  ]);
  const featMap = new Map<string, CampaignFeatureRow>(
    ((featData as CampaignFeatureRow[]) ?? []).map((f) => [f.promotion_id, f]),
  );

  const overall = (overallData?.[0] as OverallMetrics | undefined) ?? null;

  // 목적 슬라이스 (S5.2): 목적별 가중 기여매출/공헌 + 평균 적합도
  const pm = (pmData as PurposeMetric[]) ?? [];
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
  const ach = (achData as CampaignAchievement[]) ?? [];
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

  const rows: Row[] = (promos ?? []).map((p: Promotion) => {
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
  const avgDuration = n ? sum(rows.map((r) => r.promo_days)) / n : 0;
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

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* 상단 바 */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 flex-col items-center justify-center rounded-2xl bg-canvas card-soft">
            <span className="text-base font-bold leading-none">{now.getDate()}</span>
          </div>
          <div>
            <div className="text-sm font-semibold text-ink">{dateChip}</div>
            <div className="text-xs text-ink-4">캠페인 {rows.length}건 분석 중</div>
          </div>
        </div>
        <Link
          href="/predict"
          className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600"
        >
          매출 시뮬레이터 →
        </Link>
      </header>

      {/* AI 인사이트 */}
      {best?.summary && (
        <section className="mb-5 rounded-[28px] bg-canvas p-6 card-soft">
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

      {/* KPI Bento */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Kpi
          label="캠페인 기여 총 매출"
          value={wonShort(totalUplift)}
          full={won(totalUplift)}
          brand
        />
        <Kpi label="평균 직접 매출" value={wonShort(avgDirect)} sub={`캠페인 ${n}건 평균`} />
        <Kpi label="평균 간접 매출" value={wonShort(avgHalo)} sub={`캠페인 ${n}건 평균`} />
        <Kpi label="평균 운영 기간" value={`${avgDuration.toFixed(1)}일`} sub={`캠페인 ${n}건 평균`} />
      </div>

      {/* 달성률 (계획 대비 실적) — S4 */}
      <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 lg:grid-cols-3">
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
        <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 lg:grid-cols-3">
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
      <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>상시 대비 행사 일매출 (캠페인별)</CardTitle>
          <p className="-mt-2 mb-3 text-xs text-ink-4">
            <span className="font-medium text-ink-3">상시 일평균</span> = 캠페인 직전 8주의
            비캠페인 일평균 매출 · <span className="font-medium text-brand-600">행사 일평균</span> = 캠페인 기간 매출 ÷ 운영일수
            <span className="block">※ 그 캠페인에 등장한 상품들만 합산한 값 (전 매장 합계 아님)</span>
          </p>
          <BaselineVsPromo data={compData} />
        </Card>
        <div className="flex flex-col justify-center rounded-[28px] bg-canvas p-5 card-soft">
          <div className="text-[11px] font-bold uppercase tracking-[1.6px] text-ink-3">
            평소 대비 행사 매출 (전 매장)
          </div>
          <div className="mt-2 text-4xl font-bold tabular-nums text-brand-500">
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
      <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 lg:grid-cols-3">
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

        <div className="rounded-[28px] bg-canvas p-5 card-soft">
          <h2 className="mb-3 text-sm font-semibold text-ink-2">전체 간접 매출 비중</h2>
          <Donut pct={haloShare} label="기타 제품 동반구매 기여" />
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 lg:grid-cols-3">
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
}: {
  label: string;
  value: string;
  sub?: string;
  full?: string; // 데스크톱에서 풀 표기 (예: ₩3,409,316,915)
  brand?: boolean;
}) {
  return (
    <div
      className={`rounded-[24px] p-4 sm:p-5 ${
        brand ? "bg-brand-500 text-white" : "bg-canvas card-soft"
      }`}
    >
      <div className={`text-[11px] font-bold uppercase tracking-[1.4px] ${brand ? "text-brand-100" : "text-ink-3"}`}>{label}</div>
      <div className="mt-2 break-words text-lg font-bold tracking-tight tabular-nums sm:text-2xl">
        <span className={full ? "sm:hidden" : ""}>{value}</span>
        {full && <span className="hidden sm:inline">{full}</span>}
      </div>
      {sub && <div className={`mt-0.5 text-[11px] ${brand ? "text-brand-100" : "text-ink-4"}`}>{sub}</div>}
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[28px] bg-canvas p-5 card-soft ${className}`}>{children}</div>;
}

function CardTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`mb-3 text-sm font-semibold text-ink-2 ${className}`}>{children}</h2>;
}

function EmptyState() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto mt-6 max-w-lg rounded-[28px] bg-canvas p-8 text-center card-soft">
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
