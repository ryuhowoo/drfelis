import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Promotion, PromotionSummary } from "@/lib/types";
import { won, wonShort, pct } from "@/lib/format";
import { MonthlyArea, Concentric, Donut } from "./DashCharts";

export const dynamic = "force-dynamic";

type Row = Promotion & { summary: PromotionSummary | null };

export default async function Dashboard() {
  const supabase = await createClient();
  const { data: promos } = await supabase
    .from("promotions")
    .select("*")
    .order("start_date", { ascending: false });

  const rows: Row[] = await Promise.all(
    (promos ?? []).map(async (p: Promotion) => {
      const { data } = await supabase.rpc("promotion_summary", { p_id: p.id });
      return { ...p, summary: (data?.[0] as PromotionSummary) ?? null };
    }),
  );

  if (rows.length === 0) return <EmptyState />;

  const totalUplift = sum(rows.map((r) => r.summary?.total_uplift ?? 0));
  const totalContribution = sum(rows.map((r) => r.summary?.contribution ?? 0));
  const totalDirect = sum(rows.map((r) => r.summary?.direct_uplift ?? 0));
  const totalHalo = sum(rows.map((r) => r.summary?.halo_uplift ?? 0));
  const haloShare = totalUplift !== 0 ? totalHalo / totalUplift : null;

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
          예상 매출 추산 →
        </Link>
      </header>

      {/* 헤로 — AI 인사이트 */}
      <section className="mb-5 flex flex-col gap-4 rounded-[28px] bg-white p-6 card-soft sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <span className="flex h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
            AI MD 인사이트
          </div>
          <h1 className="mt-2 text-2xl font-bold leading-snug tracking-tight">
            안녕하세요 <span className="align-middle">👋</span>
          </h1>
          {best?.summary && (
            <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-neutral-600">
              가장 효과적이었던 건{" "}
              <Link href={`/promotions/${best.id}`} className="font-semibold text-brand-600 hover:underline">
                {best.name}
              </Link>
              {" "}— 증분 <strong className="text-neutral-900">{won(best.summary.total_uplift)}</strong>
              {best.summary.halo_share != null && (
                <>, 후광효과 {pct(best.summary.halo_share)}</>
              )}
              에요.
            </p>
          )}
        </div>
      </section>

      {/* KPI Bento */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Kpi label="누적 증분 기여" value={won(totalUplift)} brand />
        <Kpi label="직접효과" value={wonShort(totalDirect)} />
        <Kpi label="후광효과" value={wonShort(totalHalo)} />
        <Kpi label="누적 공헌이익" value={won(totalContribution)} />
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

        <Card className="bg-ink text-white">
          <CardTitle className="mb-0 text-neutral-300">전체 후광 비중</CardTitle>
          <Donut pct={haloShare} label="기타 제품 동반구매 기여" />
        </Card>
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

function Kpi({ label, value, brand }: { label: string; value: string; brand?: boolean }) {
  return (
    <div
      className={`rounded-[24px] p-5 ${
        brand ? "bg-brand-500 text-white" : "bg-white card-soft"
      }`}
    >
      <div className={`text-xs ${brand ? "text-brand-100" : "text-neutral-400"}`}>{label}</div>
      <div className="mt-2 text-xl font-bold tracking-tight tabular-nums sm:text-2xl">{value}</div>
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
