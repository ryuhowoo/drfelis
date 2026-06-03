import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Promotion, PromotionSummary } from "@/lib/types";
import { won, wonShort, pct } from "@/lib/format";
import { MonthlyUplift, TypeBreakdown } from "./DashCharts";

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

  // ── 집계 ──
  const totalUplift = sum(rows.map((r) => r.summary?.total_uplift ?? 0));
  const totalContribution = sum(rows.map((r) => r.summary?.contribution ?? 0));
  const haloShares = rows
    .map((r) => r.summary?.halo_share)
    .filter((x): x is number => x != null);
  const avgHalo = haloShares.length
    ? haloShares.reduce((a, b) => a + b, 0) / haloShares.length
    : null;

  const byMonth = new Map<string, number>();
  for (const r of rows) {
    const m = r.start_date.slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + (r.summary?.total_uplift ?? 0));
  }
  const monthly = [...byMonth.entries()]
    .map(([month, uplift]) => ({ month, uplift }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const byType = new Map<string, number>();
  for (const r of rows) {
    const t = r.promo_type ?? "기타";
    byType.set(t, (byType.get(t) ?? 0) + (r.summary?.total_uplift ?? 0));
  }
  const typeBreakdown = [...byType.entries()]
    .map(([label, uplift]) => ({ label, uplift }))
    .sort((a, b) => b.uplift - a.uplift)
    .slice(0, 6);

  const ranked = [...rows].sort(
    (a, b) => (b.summary?.total_uplift ?? 0) - (a.summary?.total_uplift ?? 0),
  );
  const best = ranked[0];

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">대시보드</h1>
          <p className="mt-1 text-sm text-neutral-500">
            프로모션 {rows.length}건의 성과를 한눈에
          </p>
        </div>
        <Link
          href="/predict"
          className="rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700"
        >
          예상 매출 추산 →
        </Link>
      </header>

      {/* Ambient AI 인사이트 */}
      {best?.summary && (
        <div className="mb-4 overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-50 via-white to-white p-5 ring-1 ring-indigo-100">
          <div className="flex items-center gap-2 text-xs font-medium text-indigo-600">
            <span className="flex h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
            AI 인사이트
          </div>
          <p className="mt-2 text-[15px] leading-relaxed text-neutral-800">
            가장 효과적이었던 프로모션은{" "}
            <Link href={`/promotions/${best.id}`} className="font-semibold text-indigo-700 hover:underline">
              {best.name}
            </Link>
            {" "}— 증분 <strong>{won(best.summary.total_uplift)}</strong>
            {best.summary.halo_share != null && (
              <>, 그중 후광효과 {pct(best.summary.halo_share)}</>
            )}
            {avgHalo != null && (
              <span className="text-neutral-500">
                {" "}· 전체 평균 후광비중 {pct(avgHalo)}
              </span>
            )}
          </p>
        </div>
      )}

      {/* KPI 타일 (Bento) */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Kpi label="누적 증분 기여" value={won(totalUplift)} accent />
        <Kpi label="누적 공헌이익" value={won(totalContribution)} />
        <Kpi label="평균 후광비중" value={avgHalo != null ? pct(avgHalo) : "—"} />
        <Kpi label="등록 프로모션" value={`${rows.length}건`} />
      </div>

      {/* Bento 차트 영역 */}
      <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>월별 증분 추세</CardTitle>
          <MonthlyUplift data={monthly} />
        </Card>
        <Card>
          <CardTitle>혜택 유형별 증분</CardTitle>
          <TypeBreakdown data={typeBreakdown} />
        </Card>
      </div>

      {/* 성과 랭킹 + 최고 프로모션 */}
      <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <CardTitle className="mb-0">성과 랭킹</CardTitle>
            <Link href="/library" className="text-xs text-neutral-400 hover:text-neutral-700">
              전체 보기 →
            </Link>
          </div>
          <ul className="divide-y divide-neutral-100">
            {ranked.slice(0, 6).map((r, i) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <span className="w-5 text-center text-sm font-semibold text-neutral-300">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/promotions/${r.id}`}
                    className="block truncate text-sm font-medium text-neutral-800 hover:underline"
                  >
                    {r.name}
                  </Link>
                  <div className="flex gap-1.5 text-xs text-neutral-400">
                    <span>{r.start_date.slice(0, 7)}</span>
                    {r.promo_type && <span>· {r.promo_type}</span>}
                  </div>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {wonShort(r.summary?.total_uplift)}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardTitle>가장 효과적인 프로모션</CardTitle>
          {best && (
            <div>
              <Link
                href={`/promotions/${best.id}`}
                className="text-sm font-semibold text-neutral-900 hover:underline"
              >
                {best.name}
              </Link>
              <div className="mt-3 space-y-2 text-sm">
                <Stat k="총 증분" v={won(best.summary?.total_uplift)} />
                <Stat k="직접효과" v={wonShort(best.summary?.direct_uplift)} />
                <Stat k="후광효과" v={wonShort(best.summary?.halo_uplift)} />
                <Stat k="공헌이익" v={wonShort(best.summary?.contribution)} />
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function sum(a: number[]) {
  return a.reduce((x, y) => x + y, 0);
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-2xl p-5 ring-1 ${
        accent
          ? "bg-neutral-900 text-white ring-neutral-900"
          : "bg-white ring-neutral-200/70"
      } shadow-[0_1px_3px_rgba(0,0,0,0.03)]`}
    >
      <div className={`text-xs ${accent ? "text-neutral-400" : "text-neutral-500"}`}>
        {label}
      </div>
      <div className="mt-1.5 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
        {value}
      </div>
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl bg-white p-5 ring-1 ring-neutral-200/70 shadow-[0_1px_3px_rgba(0,0,0,0.03)] ${className}`}
    >
      {children}
    </div>
  );
}

function CardTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={`mb-3 text-sm font-semibold text-neutral-700 ${className}`}>{children}</h2>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-neutral-500">{k}</span>
      <span className="font-medium tabular-nums text-neutral-800">{v}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <h1 className="text-xl font-semibold">대시보드</h1>
      <div className="mt-6 overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-50 via-white to-white p-8 text-center ring-1 ring-indigo-100">
        <p className="text-base font-medium text-neutral-800">
          아직 데이터가 없습니다.
        </p>
        <p className="mx-auto mt-1 max-w-md text-sm text-neutral-500">
          첨부해주신 마스터·일별 매출·프로모션 데이터를 한 번에 적재할 수 있어요.
          버튼 한 번이면 됩니다.
        </p>
        <Link
          href="/seed"
          className="mt-5 inline-block rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700"
        >
          초기 데이터 적재하기 →
        </Link>
        <p className="mt-3 text-xs text-neutral-400">
          또는 <Link href="/upload" className="underline">데이터 업로드</Link>에서 직접 올릴 수 있어요.
        </p>
      </div>
    </div>
  );
}
