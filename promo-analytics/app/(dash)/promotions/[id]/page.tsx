import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  Promotion,
  MeasurementRow,
  PromotionSummary,
  PromotionNote,
  PlanVsActualRow,
  PlanVsActualSummary,
  PlanVsActualOption,
} from "@/lib/types";
import { won, wonShort, pct, daysBetween } from "@/lib/format";
import UpliftChart from "./UpliftChart";
import Notes from "./Notes";
import Achievement from "./Achievement";
import PurposeBlock, { type PurposeMetricRow } from "./PurposeBlock";
import SkuMatchPanel, { type DiagnosticRow, type SkuMapping } from "./SkuMatchPanel";

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

  // 현재 가격 가이드(플랜) 요약 (S2)
  const { data: planRow } = await supabase
    .from("campaign_plans")
    .select("id, version, status, expected_revenue_total, expected_contribution_total")
    .eq("promotion_id", id)
    .eq("is_current", true)
    .maybeSingle();
  const plan = planRow as {
    version: number;
    status: string;
    expected_revenue_total: number | null;
    expected_contribution_total: number | null;
  } | null;

  // 달성률 (S3): 확정 플랜 vs 실적 + 옵션 매핑용 distinct option_info
  // + SKU 매칭 진단 (N4): 플랜·실적 한 표 (draft 도 포함) + 수동 매핑 목록
  const [
    { data: pvaSummary },
    { data: pvaRows },
    { data: pvaOptions },
    { data: optInfoRows },
    { data: diagRows },
    { data: skuMaps },
  ] = await Promise.all([
    supabase.rpc("plan_vs_actual_summary", { p_id: id }),
    supabase.rpc("plan_vs_actual", { p_id: id }),
    supabase.rpc("plan_vs_actual_options", { p_id: id }),
    supabase
      .from("promotion_sales")
      .select("option_info")
      .eq("promotion_id", id)
      .not("option_info", "is", null),
    supabase.rpc("sku_match_diagnostic", { p_id: id }),
    supabase
      .from("promotion_sku_mappings")
      .select("plan_product_id, actual_product_id")
      .eq("promotion_id", id),
  ]);
  const achSummary = (pvaSummary?.[0] as PlanVsActualSummary) ?? null;
  const achRows = (pvaRows as PlanVsActualRow[]) ?? [];
  const achOptions = (pvaOptions as PlanVsActualOption[]) ?? [];
  const optionInfos = [
    ...new Set(
      ((optInfoRows as { option_info: string | null }[]) ?? [])
        .map((r) => (r.option_info ?? "").trim())
        .filter((s) => s.length > 0),
    ),
  ].sort();
  const diagnosticRows = (diagRows as DiagnosticRow[]) ?? [];
  const skuMappings = (skuMaps as SkuMapping[]) ?? [];

  // 목적별 핵심 지표 (S5.4): 유효 가중치 × 측정·달성률·구매건수
  const [{ data: ewData }, { data: ocData }] = await Promise.all([
    supabase.rpc("effective_purpose_weights", { p_id: id }),
    supabase.from("promotion_sales").select("order_count").eq("promotion_id", id),
  ]);
  const orderCount = ((ocData as { order_count: number | null }[]) ?? []).reduce(
    (s, r) => s + (Number(r.order_count) || 0),
    0,
  );
  const upliftPct =
    summary && summary.actual_revenue - summary.total_uplift > 0
      ? summary.total_uplift / (summary.actual_revenue - summary.total_uplift)
      : null;
  const purposeRows: PurposeMetricRow[] = (
    (ewData as { purpose: string; weight: number }[]) ?? []
  ).map((w) => {
    const kind: PurposeMetricRow["kind"] =
      w.purpose === "재고소진"
        ? "stock"
        : w.purpose === "브랜딩"
          ? "branding"
          : w.purpose === "세일즈"
            ? "sales"
            : "other";
    return {
      purpose: w.purpose,
      weight: Number(w.weight),
      kind,
      uplift: summary?.total_uplift ?? null,
      contribution: summary?.contribution ?? null,
      uplift_pct: upliftPct,
      ach_qty: achSummary?.ach_qty ?? null,
      qty_reliable: achSummary?.quantity_reliable ?? false,
      order_count: orderCount,
    };
  });

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
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <div className="mb-1 text-sm text-neutral-400">
        <Link href="/" className="hover:underline">
          대시보드
        </Link>{" "}
        / 캠페인
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
          className="shrink-0 rounded-xl border border-neutral-200 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
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

      {/* 측정 v2: 보정 적용 안내 */}
      <MeasurementBanner summary={summary} rows={rows} />

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="캠페인 총 매출" value={won(summary?.actual_revenue)} primary />
        <Stat
          label="총 기여 매출"
          value={won(summary?.total_uplift)}
          sub={summary?.uplift_ci ? `±${wonShort(summary.uplift_ci)} (95% CI)` : undefined}
        />
        <Stat label="메인 상품 직접 매출" value={wonShort(summary?.direct_uplift)} />
        <Stat
          label="간접 매출"
          value={wonShort(summary?.halo_uplift)}
          sub={summary?.halo_share != null ? `비중 ${pct(summary.halo_share)}` : undefined}
        />
        <Stat
          label="공헌이익"
          value={wonShort(summary?.contribution)}
          sub={
            summary?.contribution_rate != null
              ? `이익률 ${pct(summary.contribution_rate)}`
              : undefined
          }
        />
      </div>

      {/* 가격 가이드(플랜) 요약 + CTA */}
      <div className="mt-6 rounded-[24px] bg-white card-soft p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-700">가격 가이드(플랜)</h2>
            {plan ? (
              <p className="mt-1 text-sm text-neutral-500">
                v{plan.version} ·{" "}
                <span
                  className={
                    plan.status === "confirmed" ? "text-green-600" : "text-amber-600"
                  }
                >
                  {plan.status === "confirmed" ? "확정됨" : "draft"}
                </span>{" "}
                · 예상 매출 {won(plan.expected_revenue_total)} · 예상 공헌이익{" "}
                {won(plan.expected_contribution_total)}
              </p>
            ) : (
              <p className="mt-1 text-sm text-neutral-500">
                아직 플랜이 없습니다. 옵션(다중 SKU 묶음)·예상 세트수로 예상 성과를 미리
                계산하세요.
              </p>
            )}
          </div>
          <Link
            href={`/promotions/${id}/plan`}
            className="shrink-0 rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            {plan ? "플랜 편집" : "플랜 만들기"}
          </Link>
        </div>
      </div>

      {/* 달성률 (S3) */}
      <Achievement
        promotionId={id}
        summary={achSummary}
        rows={achRows}
        options={achOptions}
        optionInfos={optionInfos}
      />

      {/* SKU 매칭 진단 (N4) — 플랜·실적 양쪽 SKU 한 표 + 수동 연동 */}
      {(diagnosticRows.length > 0 || skuMappings.length > 0) && (
        <SkuMatchPanel
          promotionId={id}
          rows={diagnosticRows}
          mappings={skuMappings}
        />
      )}

      {/* 목적별 핵심 지표 (S5.4) */}
      <PurposeBlock rows={purposeRows} />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* 측정 테이블 */}
        <section className="lg:col-span-3">
          <h2 className="mb-2 text-sm font-semibold text-neutral-700">
            상품별 증분 측정
          </h2>
          <div className="overflow-x-auto rounded-[24px] bg-white card-soft">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2.5 font-medium">상품</th>
                  <th className="px-3 py-2.5 text-right font-medium">baseline/일</th>
                  <th className="px-3 py-2.5 text-right font-medium">실적</th>
                  <th className="px-3 py-2.5 text-right font-medium">기대</th>
                  <th className="px-3 py-2.5 text-right font-medium">증분 ±95% CI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((r) => {
                  const significant =
                    r.uplift_ci > 0 && Math.abs(r.uplift_revenue) > r.uplift_ci;
                  return (
                    <tr key={r.product_id} className="hover:bg-neutral-50">
                      <td className="px-3 py-2.5">
                        <span className="text-neutral-800">{r.base_name}</span>
                        {r.is_main && (
                          <span className="ml-1.5 rounded bg-brand-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                            메인
                          </span>
                        )}
                        {r.cold_start && (
                          <span
                            className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                            title={`baseline 관측 ${r.observed_baseline_days}일 (14일 미만) — 측정 신뢰도 낮음`}
                          >
                            신상품
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-neutral-500">
                        {wonShort(r.baseline_daily_revenue)}
                        {!r.cold_start && r.observed_baseline_days > 0 && (
                          <span className="ml-1 text-[10px] text-neutral-400">
                            ({r.observed_baseline_days}일)
                          </span>
                        )}
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
                        <div className="flex items-center justify-end gap-1">
                          <span>{wonShort(r.uplift_revenue)}</span>
                          {!significant && r.uplift_ci > 0 && !r.cold_start && (
                            <span
                              className="text-[10px] text-neutral-400"
                              title="증분이 baseline 변동성 범위 안 — 통계적으로 유의하지 않음"
                            >
                              n.s.
                            </span>
                          )}
                        </div>
                        {r.uplift_ci > 0 && !r.cold_start && (
                          <div className="text-[10px] font-normal text-neutral-400">
                            ±{wonShort(r.uplift_ci)}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-neutral-400">
                      캠페인 기간의 판매 데이터가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-neutral-400">
            baseline = 직전 8주 비캠페인 일자의 요일별 평균 (±2σ 트림). 추세 보정 적용. 95% CI는 baseline 변동성 기준.
          </p>
        </section>

        {/* 차트 */}
        <section className="lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-neutral-700">
            증분 Top 10 (검정=메인 · 회색=후광)
          </h2>
          <div className="rounded-[24px] bg-white card-soft p-4">
            <UpliftChart data={chartData} />
          </div>

          <div className="mt-4 rounded-[24px] bg-white card-soft p-4">
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

function MeasurementBanner({
  summary,
  rows,
}: {
  summary: PromotionSummary | null;
  rows: MeasurementRow[];
}) {
  if (!summary || rows.length === 0) return null;
  const cold = summary.cold_start_count;
  const trend = summary.trend_factor;
  const trendPct = (trend - 1) * 100;
  const significant =
    summary.uplift_ci > 0 && Math.abs(summary.total_uplift) > summary.uplift_ci;

  const chips: { label: string; tone: "neutral" | "warn" | "ok" }[] = [];
  if (Math.abs(trendPct) >= 1) {
    chips.push({
      label: `추세 보정 ${trendPct > 0 ? "+" : ""}${trendPct.toFixed(1)}%`,
      tone: "neutral",
    });
  }
  if (cold > 0) {
    chips.push({ label: `신상품 ${cold}건`, tone: "warn" });
  }
  if (summary.uplift_ci > 0) {
    chips.push({
      label: significant ? "통계적 유의" : "유의성 낮음",
      tone: significant ? "ok" : "warn",
    });
  }
  if (chips.length === 0) return null;

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-[20px] bg-white card-soft px-4 py-3">
      <span className="text-xs font-medium text-neutral-500">측정 보정</span>
      {chips.map((c) => (
        <span
          key={c.label}
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
            c.tone === "ok"
              ? "bg-emerald-50 text-emerald-700"
              : c.tone === "warn"
              ? "bg-amber-50 text-amber-700"
              : "bg-neutral-100 text-neutral-600"
          }`}
        >
          {c.label}
        </span>
      ))}
      <span className="text-[11px] text-neutral-400">
        요일 보정·±2σ 트림 적용 / baseline은 직전 8주, 추세는 8주 대비 16주 평균
      </span>
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
          ? "border-neutral-900 bg-brand-500 text-white"
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
