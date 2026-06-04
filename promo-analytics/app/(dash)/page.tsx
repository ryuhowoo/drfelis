import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Promotion, PromotionSummary, MeasurementRow } from "@/lib/types";
import { won, wonShort, pct } from "@/lib/format";
import { MonthlyArea, Concentric, Donut, BaselineVsPromo } from "./DashCharts";

export const dynamic = "force-dynamic";

type Row = Promotion & {
  summary: PromotionSummary | null;
  baseline_daily: number;
  promo_daily: number;
  promo_days: number;
};

export default async function Dashboard() {
  const supabase = await createClient();
  const { data: promos } = await supabase
    .from("promotions")
    .select("*")
    .order("start_date", { ascending: false });

  const rows: Row[] = await Promise.all(
    (promos ?? []).map(async (p: Promotion) => {
      const [{ data: s }, { data: m }] = await Promise.all([
        supabase.rpc("promotion_summary", { p_id: p.id }),
        supabase.rpc("promotion_measurement", { p_id: p.id }),
      ]);
      const meas = (m as MeasurementRow[]) ?? [];
      const promo_days = meas[0]?.promo_days ?? 1;
      const baseline_daily = sum(meas.map((x) => x.baseline_daily_revenue));
      const promo_daily =
        promo_days > 0 ? sum(meas.map((x) => x.actual_revenue)) / promo_days : 0;
      return {
        ...p,
        summary: (s?.[0] as PromotionSummary) ?? null,
        baseline_daily,
        promo_daily,
        promo_days,
      };
    }),
  );

  if (rows.length === 0) return <EmptyState />;

  const n = rows.length;
  const totalUplift = sum(rows.map((r) => r.summary?.total_uplift ?? 0));
  const totalDirect = sum(rows.map((r) => r.summary?.direct_uplift ?? 0));
  const totalHalo = sum(rows.map((r) => r.summary?.halo_uplift ?? 0));
  const avgDirect = n ? totalDirect / n : 0;
  const avgHalo = n ? totalHalo / n : 0;
  const avgDuration = n ? sum(rows.map((r) => r.promo_days)) / n : 0;
  const haloShare = totalUplift !== 0 ? totalHalo / totalUplift : null;

  // 상시 일평균 vs 행사 일평균
  const totalBaselineDaily = sum(rows.map((r) => r.baseline_daily));
  const totalPromoDaily = sum(rows.map((r) => r.promo_daily));
  const liftRatio =
    totalBaselineDaily > 0 ? totalPromoDaily / totalBaselineDaily : null;
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
          <div className="flex h-12 w-12 flex-col items-center justify-center rounded-2xl bg-white card-soft">
            <span className="text-base font-bold leading-none">{now.getDate()}</span>
          </div>
          <div>
            <div className="text-sm font-semibold">{dateChip}</div>
            <div className="text-xs text-neutral-400">프로모션 {rows.length}건 분석 중</div>
          </div>
        </div>
        <Link
          href="/predict"
          className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_-10px_var(--color-brand-500)] transition hover:bg-brand-600"
        >
          매출 시뮬레이터 →
        </Link>
      </header>

      {/* AI 인사이트 */}
      {best?.summary && (
        <section className="mb-5 rounded-[28px] bg-white p-6 card-soft">
          <div className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <span className="flex h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
            AI MD 인사이트
          </div>
          <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-neutral-700">
            가장 효과적이었던 건{" "}
            <Link href={`/promotions/${best.id}`} className="font-semibold text-brand-600 hover:underline">
              {best.name}
            </Link>
            {" "}— 기여 매출 <strong className="text-neutral-900">{won(best.summary.total_uplift)}</strong>
            {best.summary.halo_share != null && <>, 간접 비중 {pct(best.summary.halo_share)}</>}.
            {liftRatio != null && (
              <> 프로모션 기간엔 평소(상시 일평균)보다 <strong className="text-brand-600">{liftRatio.toFixed(1)}배</strong> 더 팔렸어요.</>
            )}
          </p>
        </section>
      )}

      {/* KPI Bento */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Kpi label="프로모션 기여 총 매출" value={won(totalUplift)} brand />
        <Kpi label="평균 직접 매출" value={wonShort(avgDirect)} sub={`프로모션 ${n}건 평균`} />
        <Kpi label="평균 간접 매출" value={wonShort(avgHalo)} sub={`프로모션 ${n}건 평균`} />
        <Kpi label="평균 운영 기간" value={`${avgDuration.toFixed(1)}일`} sub={`프로모션 ${n}건 평균`} />
      </div>

      {/* 상시 vs 행사 비교 (비교 기준) */}
      <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>상시 대비 행사 일매출</CardTitle>
          <p className="-mt-2 mb-3 text-xs text-neutral-400">
            <span className="font-medium text-neutral-500">상시 일평균</span> = 프로모션 직전 8주의
            비프로모션 일평균 매출 · <span className="font-medium text-brand-600">행사 일평균</span> = 프로모션 기간 매출 ÷ 운영일수
          </p>
          <BaselineVsPromo data={compData} />
        </Card>
        <div className="flex flex-col justify-center rounded-[28px] bg-neutral-900 p-5 text-white card-soft">
          <div className="text-xs text-neutral-400">평소 대비 행사 매출</div>
          <div className="mt-1 text-4xl font-bold text-brand-400">
            {liftRatio != null ? `${liftRatio.toFixed(1)}배` : "—"}
          </div>
          <div className="mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-neutral-400">상시 일평균</span>
              <span className="tabular-nums text-white">{wonShort(totalBaselineDaily)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">행사 일평균</span>
              <span className="font-semibold tabular-nums text-brand-400">{wonShort(totalPromoDaily)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 차트 Bento */}
      <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <CardTitle className="mb-0">월별 증분 추세</CardTitle>
            {trend != null && (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  trend >= 0 ? "bg-brand-50 text-brand-600" : "bg-neutral-100 text-neutral-500"
                }`}
              >
                {trend >= 0 ? "▲" : "▼"} {pct(Math.abs(trend), 1)}
              </span>
            )}
          </div>
          <MonthlyArea data={monthly} />
        </Card>

        <div className="rounded-[28px] bg-neutral-900 p-5 text-white card-soft">
          <h2 className="mb-3 text-sm font-semibold text-neutral-300">전체 간접 매출 비중</h2>
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
            <Link href="/library" className="text-xs text-neutral-400 hover:text-brand-600">
              전체 보기 →
            </Link>
          </div>
          <ul className="divide-y divide-neutral-100">
            {ranked.slice(0, 6).map((r, i) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    i === 0 ? "bg-brand-500 text-white" : "bg-neutral-100 text-neutral-400"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/promotions/${r.id}`}
                    className="block truncate text-sm font-medium text-neutral-800 hover:text-brand-600"
                  >
                    {r.name}
                  </Link>
                  <div className="flex gap-1.5 text-xs text-neutral-400">
                    <span>{r.start_date.slice(0, 7)}</span>
                    {r.promo_type && <span>· {r.promo_type}</span>}
                  </div>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums text-neutral-900">
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

function Kpi({ label, value, sub, brand }: { label: string; value: string; sub?: string; brand?: boolean }) {
  return (
    <div
      className={`rounded-[24px] p-5 ${
        brand ? "bg-brand-500 text-white" : "bg-white card-soft"
      }`}
    >
      <div className={`text-xs ${brand ? "text-brand-100" : "text-neutral-400"}`}>{label}</div>
      <div className="mt-2 text-xl font-bold tracking-tight tabular-nums sm:text-2xl">{value}</div>
      {sub && <div className={`mt-0.5 text-[11px] ${brand ? "text-brand-100" : "text-neutral-400"}`}>{sub}</div>}
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[28px] bg-white p-5 card-soft ${className}`}>{children}</div>;
}

function CardTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`mb-3 text-sm font-semibold text-neutral-700 ${className}`}>{children}</h2>;
}

function EmptyState() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto mt-6 max-w-lg rounded-[28px] bg-white p-8 text-center card-soft">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500 text-xl text-white">
          ✦
        </div>
        <p className="text-base font-semibold text-neutral-800">아직 데이터가 없습니다.</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-neutral-500">
          첨부해주신 마스터·일별 매출·프로모션 데이터를 버튼 한 번으로 적재할 수 있어요.
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
