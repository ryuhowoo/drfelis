import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  Promotion,
  MeasurementRow,
  PromotionSummary,
  PromotionNote,
} from "@/lib/types";
import { won, wonShort, pct, daysBetween } from "@/lib/format";
import UpliftChart from "./UpliftChart";
import Notes from "./Notes";

export const dynamic = "force-dynamic";

export default async function PromotionDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: promo } = await supabase
    .from("promotions")
    .select("*")
    .eq("id", id)
    .single<Promotion>();
  if (!promo) notFound();

  const [{ data: mData }, { data: sData }, { data: nData }] = await Promise.all([
    supabase.rpc("promotion_measurement", { p_id: id }),
    supabase.rpc("promotion_summary", { p_id: id }),
    supabase
      .from("promotion_notes")
      .select("*")
      .eq("promotion_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const rows = ((mData as MeasurementRow[]) ?? []).sort(
    (a, b) => b.uplift_revenue - a.uplift_revenue,
  );
  const summary = (sData?.[0] as PromotionSummary) ?? null;
  const notes = (nData as PromotionNote[]) ?? [];

  const mains = rows.filter((r) => r.is_main);
  const chartData = rows
    .filter((r) => Math.abs(r.uplift_revenue) > 0)
    .slice(0, 10)
    .map((r) => ({
      name: r.base_name,
      uplift: r.uplift_revenue,
      isMain: r.is_main,
    }));

  const suggested = buildQuestions(rows, summary);
  const hasBaseline = rows.some((r) => r.baseline_daily_revenue > 0);

  return (
    <div className="px-8 py-7">
      <div className="mb-1 text-sm text-neutral-400">
        <Link href="/" className="hover:underline">
          대시보드
        </Link>{" "}
        / 프로모션
      </div>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{promo.name}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {promo.start_date} ~ {promo.end_date} (
            {daysBetween(promo.start_date, promo.end_date)}일)
            {promo.season_tag && ` · ${promo.season_tag}`}
            {promo.promo_type && ` · ${promo.promo_type}`}
          </p>
        </div>
        <Link
          href={`/promotions/${id}/edit`}
          className="shrink-0 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
        >
          메타·메인상품 편집
        </Link>
      </header>

      {!hasBaseline && (
        <div className="mb-5 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          직전 8주 baseline 데이터가 부족합니다. <strong>일별 매출 추이</strong>를
          충분히 업로드하면 증분이 정확해집니다.
        </div>
      )}

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="총 증분 기여" value={won(summary?.total_uplift)} primary />
        <Stat label="직접효과 (메인)" value={won(summary?.direct_uplift)} />
        <Stat
          label="후광효과 (기타)"
          value={won(summary?.halo_uplift)}
          sub={summary?.halo_share != null ? `비중 ${pct(summary.halo_share)}` : undefined}
        />
        <Stat
          label="공헌이익"
          value={won(summary?.contribution)}
          sub={
            summary?.contribution_rate != null
              ? `이익률 ${pct(summary.contribution_rate)}`
              : undefined
          }
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* 측정 테이블 */}
        <section className="lg:col-span-3">
          <h2 className="mb-2 text-sm font-semibold text-neutral-700">
            상품별 증분 측정
          </h2>
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2.5 font-medium">상품</th>
                  <th className="px-3 py-2.5 text-right font-medium">baseline/일</th>
                  <th className="px-3 py-2.5 text-right font-medium">실적</th>
                  <th className="px-3 py-2.5 text-right font-medium">기대</th>
                  <th className="px-3 py-2.5 text-right font-medium">증분</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((r) => (
                  <tr key={r.product_id} className="hover:bg-neutral-50">
                    <td className="px-3 py-2.5">
                      <span className="text-neutral-800">{r.base_name}</span>
                      {r.is_main && (
                        <span className="ml-1.5 rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium text-white">
                          메인
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-neutral-500">
                      {wonShort(r.baseline_daily_revenue)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-neutral-600">
                      {wonShort(r.actual_revenue)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-neutral-400">
                      {wonShort(r.expected_revenue)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-semibold ${
                        r.uplift_revenue < 0 ? "text-red-600" : "text-neutral-900"
                      }`}
                    >
                      {wonShort(r.uplift_revenue)}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-neutral-400">
                      프로모션 기간의 판매 데이터가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 차트 */}
        <section className="lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-neutral-700">
            증분 Top 10 (검정=메인 · 회색=후광)
          </h2>
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <UpliftChart data={chartData} />
          </div>

          <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
            <div className="text-xs text-neutral-500">메인 상품</div>
            {mains.length > 0 ? (
              <ul className="mt-1.5 space-y-1 text-sm">
                {mains.map((m) => (
                  <li key={m.product_id} className="flex justify-between">
                    <span className="truncate text-neutral-700">{m.base_name}</span>
                    <span className="ml-2 shrink-0 text-neutral-500">
                      증분 {wonShort(m.uplift_revenue)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-neutral-400">
                아직 메인 상품이 지정되지 않았습니다.{" "}
                <Link href={`/promotions/${id}/edit`} className="underline">
                  지정하기
                </Link>
              </p>
            )}
          </div>
        </section>
      </div>

      {/* 정성 메모 */}
      <section className="mt-8 max-w-3xl">
        <h2 className="mb-1 text-sm font-semibold text-neutral-700">
          성과의 원인 — 집요하게 묻기
        </h2>
        <p className="mb-3 text-xs text-neutral-400">
          여기 쌓인 원인·가설이 예측 정확도를 높입니다.
        </p>
        <Notes promotionId={id} notes={notes} suggested={suggested} />
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  primary,
}: {
  label: string;
  value: string;
  sub?: string;
  primary?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        primary
          ? "border-neutral-900 bg-neutral-900 text-white"
          : "border-neutral-200 bg-white"
      }`}
    >
      <div className={`text-xs ${primary ? "text-neutral-300" : "text-neutral-500"}`}>
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {sub && (
        <div className={`mt-0.5 text-xs ${primary ? "text-neutral-300" : "text-neutral-400"}`}>
          {sub}
        </div>
      )}
    </div>
  );
}

function buildQuestions(
  rows: MeasurementRow[],
  summary: PromotionSummary | null,
): string[] {
  const qs: string[] = [];
  const topMain = rows.filter((r) => r.is_main)[0];
  const topHalo = rows.filter((r) => !r.is_main)[0];
  const worst = [...rows].sort((a, b) => a.uplift_revenue - b.uplift_revenue)[0];

  if (topMain && topMain.uplift_revenue > 0)
    qs.push(`메인 '${topMain.base_name}'의 증분이 컸어요. 광고·노출을 늘렸나요?`);
  if (topHalo && topHalo.uplift_revenue > 0)
    qs.push(`'${topHalo.base_name}'가 함께 잘 팔렸어요. 동반구매를 유도한 요인은?`);
  if (worst && worst.uplift_revenue < 0)
    qs.push(`'${worst.base_name}'는 증분이 마이너스였어요. 원인이 있나요?`);
  if (summary && summary.halo_share != null && summary.halo_share > 0.4)
    qs.push("후광효과 비중이 높습니다. 어떤 상품군이 같이 담겼나요?");
  qs.push("이 기간에 외부 이벤트(시즌·경쟁사·트렌드)가 있었나요?");
  return qs.slice(0, 4);
}
