import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Promotion, PromotionSummary } from "@/lib/types";
import { wonShort, pct, daysBetween } from "@/lib/format";

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

  const totalUplift = rows.reduce(
    (s, r) => s + (r.summary?.total_uplift ?? 0),
    0,
  );

  return (
    <div className="px-8 py-7">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">대시보드</h1>
          <p className="mt-1 text-sm text-neutral-500">
            등록된 프로모션 {rows.length}건 · 누적 증분 기여{" "}
            <strong className="text-neutral-800">{wonShort(totalUplift)}</strong>
          </p>
        </div>
        <Link
          href="/upload"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          데이터 업로드
        </Link>
      </header>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-4 py-3 font-medium">프로모션</th>
                <th className="px-4 py-3 font-medium">기간</th>
                <th className="px-4 py-3 text-right font-medium">총 증분</th>
                <th className="px-4 py-3 text-right font-medium">직접</th>
                <th className="px-4 py-3 text-right font-medium">후광</th>
                <th className="px-4 py-3 text-right font-medium">후광비중</th>
                <th className="px-4 py-3 text-right font-medium">공헌이익</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-neutral-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/promotions/${r.id}`}
                      className="font-medium text-neutral-900 hover:underline"
                    >
                      {r.name}
                    </Link>
                    <div className="mt-0.5 flex gap-1.5 text-xs text-neutral-400">
                      {r.season_tag && <span>{r.season_tag}</span>}
                      {r.promo_type && <span>· {r.promo_type}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-neutral-500">
                    {r.start_date}~{r.end_date}
                    <span className="ml-1 text-xs text-neutral-400">
                      ({daysBetween(r.start_date, r.end_date)}일)
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {wonShort(r.summary?.total_uplift)}
                  </td>
                  <td className="px-4 py-3 text-right text-neutral-600">
                    {wonShort(r.summary?.direct_uplift)}
                  </td>
                  <td className="px-4 py-3 text-right text-neutral-600">
                    {wonShort(r.summary?.halo_uplift)}
                  </td>
                  <td className="px-4 py-3 text-right text-neutral-600">
                    {pct(r.summary?.halo_share)}
                  </td>
                  <td className="px-4 py-3 text-right text-neutral-600">
                    {wonShort(r.summary?.contribution)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-white px-8 py-16 text-center">
      <p className="text-sm text-neutral-600">
        아직 등록된 프로모션이 없습니다.
      </p>
      <p className="mt-1 text-sm text-neutral-400">
        먼저 <strong>일별 매출 추이</strong>와 <strong>마스터</strong>를 올린 뒤,
        프로모션 시트를 업로드하세요.
      </p>
      <Link
        href="/upload"
        className="mt-5 inline-block rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
      >
        데이터 업로드로 이동
      </Link>
    </div>
  );
}
