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
import { won, wonShort, pct, num, daysBetween } from "@/lib/format";
import { InlineAlert } from "@/components/ui";
import { ProgressMetric } from "@/components/ui/ProgressMetric";
import { deriveWorkflow, deriveActions } from "@/lib/campaign-workflow";
import UpliftChart from "./UpliftChart";
import Notes from "./Notes";
import Achievement from "./Achievement";
import PurposeBlock, { type PurposeMetricRow } from "./PurposeBlock";
import { type DiagnosticRow, type SkuMapping } from "./SkuMatchPanel";
import ActualsLink, { type ActualsCandidate } from "./ActualsLink";
import CampaignTrend, { type DailyPoint } from "./CampaignTrend";
import { CampaignWorkflowBar } from "./CampaignWorkflowBar";
import { ActionPanel } from "./ActionPanel";
import { DetailTabsNav, type DetailView } from "./DetailTabsNav";

export const dynamic = "force-dynamic";

// 0022 롤업 번들 — 13개 쿼리(4블록 순차)를 1회 왕복으로 통합
type DetailBundle = {
  promo: Promotion | null;
  rollup: {
    features: (PromotionSummary & { baseline_daily?: number }) | null;
    measurement: MeasurementRow[];
    pva_summary: PlanVsActualSummary | null;
    pva_rows: PlanVsActualRow[];
    pva_options: PlanVsActualOption[];
    diagnostic: DiagnosticRow[];
    daily: DailyPoint[];
  } | null;
  notes: PromotionNote[];
  plan: {
    version: number;
    status: string;
    expected_revenue_total: number | null;
    expected_contribution_total: number | null;
    actual_promotion_id: string | null;
  } | null;
  candidates: ActualsCandidate[];
  linked_plans: { plan_id: string; code: string | null; name: string | null; promotion_id: string | null }[];
  option_infos: string[];
  order_count: number;
  mappings: SkuMapping[];
  weights: { purpose: string; weight: number }[];
  sources: UploadSource[];
};

type UploadSource = {
  id: string;
  kind: string;
  source_file: string;
  detail: string | null;
  row_count: number | null;
  action: string | null;
  created_at: string;
};

const VALID_VIEWS: DetailView[] = ["overview", "skus", "trend", "purpose", "sources"];

export default async function PromotionDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const view: DetailView = VALID_VIEWS.includes(sp.view as DetailView)
    ? (sp.view as DetailView)
    : "overview";
  const supabase = await createClient();

  const { data: bundleData, error: bundleError } = await supabase.rpc(
    "promotion_detail_bundle",
    { p_id: id },
  );
  if (bundleError) {
    throw new Error(`분석 데이터를 불러오지 못했습니다: ${bundleError.message}`);
  }
  const bundle = (bundleData as DetailBundle | null) ?? null;
  const promo = bundle?.promo ?? null;
  if (!promo) notFound();

  const rows = (bundle?.rollup?.measurement ?? []).sort(
    (a, b) => b.uplift_revenue - a.uplift_revenue,
  );
  const summary = bundle?.rollup?.features ?? null;
  const notes = bundle?.notes ?? [];
  const plan = bundle?.plan ?? null;
  const candidates = bundle?.candidates ?? [];
  const linkedPlans = bundle?.linked_plans ?? [];
  const linkedActualName = plan?.actual_promotion_id
    ? candidates.find((c) => c.id === plan.actual_promotion_id)?.name ?? null
    : null;

  const achSummary = bundle?.rollup?.pva_summary ?? null;
  const achRows = bundle?.rollup?.pva_rows ?? [];
  const achOptions = bundle?.rollup?.pva_options ?? [];
  const optionInfos = [
    ...new Set(
      (bundle?.option_infos ?? []).map((s) => s.trim()).filter((s) => s.length > 0),
    ),
  ].sort();
  const diagnosticRows = bundle?.rollup?.diagnostic ?? [];
  const skuMappings = bundle?.mappings ?? [];
  const sources = bundle?.sources ?? [];

  // 목적별 핵심 지표 (S5.4)
  const ewData = bundle?.weights ?? [];
  const orderCount = Number(bundle?.order_count) || 0;
  const upliftPct =
    summary && summary.actual_revenue - summary.total_uplift > 0
      ? summary.total_uplift / (summary.actual_revenue - summary.total_uplift)
      : null;
  const purposeRows: PurposeMetricRow[] = ewData.map((w) => {
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
    .map((r) => ({ name: r.base_name, uplift: r.uplift_revenue, isMain: r.is_main }));

  const suggested = buildQuestions(rows, summary);
  const hasBaseline = rows.some((r) => r.baseline_daily_revenue > 0);

  // ── 생애주기 워크플로 + 즉시 조치 (Layer A/B) ────────────────
  const today = new Date().toISOString().slice(0, 10);
  const unmatchedCount = diagnosticRows.filter(
    (r) => r.side !== "both" && !r.is_mapped && !r.is_subscription,
  ).length;
  // self-비교(기본): 가이드·실적이 같은 코드로 올라와 실 매출이 이미 잡히면
  // 명시적 짝짓기(actual_promotion_id)가 없어도 "실적 연결"은 충족된 것으로 본다.
  const hasSelfActuals = (achSummary?.campaign_revenue_total ?? 0) > 0;
  const wfInput = {
    hasPlan: !!plan,
    planConfirmed: plan?.status === "confirmed",
    hasActualLink: !!plan?.actual_promotion_id || hasSelfActuals,
    hasActualData: !!achSummary?.has_confirmed_plan,
    unmatchedCount,
    expectedContribution:
      achSummary?.expected_contribution_total ?? plan?.expected_contribution_total ?? null,
    hasBaseline,
    notesCount: notes.length,
    isEnded: !!promo.end_date && promo.end_date < today,
  };
  const workflow = deriveWorkflow(wfInput);
  const actions = deriveActions(wfInput, { promotionId: id });
  const basePath = `/promotions/${id}`;
  // '메인 제품 수량 달성' — 상시(단건) 기준을 주값으로, 구독분은 보조 표기 (N12)
  const mainSubQty = achSummary?.main_subscription_qty ?? 0;
  const mainNonsubQty = achSummary?.main_nonsub_qty ?? 0;
  const expQty = achSummary?.expected_qty_total ?? 0;
  const sangsiRatio = achSummary && expQty > 0 ? mainNonsubQty / expQty : null;
  const qtyShort = expQty - mainNonsubQty > 0 ? `${num(expQty - mainNonsubQty)}개 부족` : undefined;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <div className="mb-1 text-sm text-ink-4">
        <Link href="/" className="hover:underline">
          대시보드
        </Link>{" "}
        / 캠페인
      </div>
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{promo.name}</h1>
          <p className="mt-1 text-sm text-ink-3">
            {promo.start_date} ~ {promo.end_date} ({daysBetween(promo.start_date, promo.end_date)}일)
            {promo.season_tag && ` · ${promo.season_tag}`}
            {promo.promo_type && ` · ${promo.promo_type}`}
          </p>
        </div>
        <Link
          href={`/promotions/${id}/edit`}
          className="shrink-0 rounded-xl border border-line px-4 py-2 text-sm font-medium hover:bg-soft"
        >
          메타·메인상품 편집
        </Link>
      </header>

      {linkedPlans.length > 0 && (
        <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-2.5 text-sm text-ink-2">
          이 캠페인의 실적은{" "}
          {linkedPlans.map((lp, i) => (
            <span key={lp.plan_id}>
              {i > 0 && ", "}
              <Link
                href={lp.promotion_id ? `/promotions/${lp.promotion_id}` : "/plans"}
                className="font-semibold text-brand-700 hover:underline"
              >
                {lp.name ?? lp.code} 플랜
              </Link>
            </span>
          ))}
          의 비교 대상입니다. <strong>플랜 vs 실적 비교·SKU 매칭은 플랜이 있는 캠페인에서</strong> 진행하세요.
        </div>
      )}

      {/* Layer A — 생애주기 + 핵심 결과 + 즉시 조치 */}
      <CampaignWorkflowBar steps={workflow} basePath={basePath} />

      {wfInput.hasActualData && achSummary ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ProgressMetric
            label="캠페인 매출 달성 (전체)"
            ratio={achSummary.revenue_ach_total}
            valueLabel={wonShort(achSummary.campaign_revenue_total)}
            targetLabel={wonShort(achSummary.expected_revenue_total)}
            caption="메인 + 함께 구매, 구독 제외"
            primary
            action={
              <Link href={`${basePath}?view=skus`} scroll={false} className="text-[11px] font-semibold text-brand-700 hover:underline">
                SKU·옵션 분석 →
              </Link>
            }
          />
          <ProgressMetric
            label="메인 제품 수량 달성"
            ratio={sangsiRatio}
            valueLabel={num(mainNonsubQty)}
            targetLabel={num(expQty)}
            caption={`상시(단건) 기준${mainSubQty > 0 ? ` · 구독 ${num(mainSubQty)}개 별도` : ""}`}
            delta={qtyShort}
          />
          <ProgressMetric
            label="공헌이익 달성 (전체)"
            ratio={achSummary.contribution_ach_total}
            valueLabel={wonShort(achSummary.contribution_total)}
            targetLabel={wonShort(achSummary.expected_contribution_total)}
            caption="전체 실적 기준 · 구독 제외"
            note={
              (achSummary.expected_contribution_total ?? 0) <= 0
                ? "원가/판매가 확인 필요"
                : undefined
            }
          />
        </div>
      ) : (
        <InlineAlert
          tone="info"
          title="확정 플랜 + 실적 연결 시 달성 KPI가 표시됩니다"
          action={
            <Link href={`${basePath}/plan`} className="rounded-lg bg-card/70 px-2.5 py-1 text-[11px] font-semibold text-ink-2 hover:bg-card">
              {plan ? "플랜 편집" : "플랜 만들기"} →
            </Link>
          }
        >
          {plan
            ? `플랜 v${plan.version} · ${plan.status === "confirmed" ? "확정됨" : "draft"} · 예상 매출 ${won(plan.expected_revenue_total)}`
            : "옵션·예상 세트수로 예상 성과를 미리 계산하세요."}
        </InlineAlert>
      )}

      <div className="mt-4">
        <ActionPanel actions={actions} basePath={basePath} />
      </div>

      {/* Layer C — 심층 분석 (탭, URL 보존, 선택 탭만 렌더) */}
      <div className="mt-6">
        <DetailTabsNav active={view} basePath={basePath} badges={{ skus: unmatchedCount || undefined }} />

        {view === "overview" && (
          <div>
            {!hasBaseline && (
              <div className="mb-4 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
                직전 8주 baseline 데이터가 부족합니다. <strong>일별 매출 추이</strong>를 충분히 업로드하면 증분이 정확해집니다.
              </div>
            )}
            <MeasurementBanner summary={summary} rows={rows} />
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
                sub={summary?.contribution_rate != null ? `이익률 ${pct(summary.contribution_rate)}` : undefined}
              />
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
              <section className="lg:col-span-3">
                <h2 className="mb-2 text-sm font-semibold text-ink-2">상품별 증분 측정</h2>
                <div className="overflow-x-auto rounded-2xl card-soft">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-soft/60 text-left text-xs text-ink-3">
                      <tr>
                        <th className="px-3 py-2.5 font-medium">상품</th>
                        <th className="px-3 py-2.5 text-right font-medium">baseline/일</th>
                        <th className="px-3 py-2.5 text-right font-medium">실적</th>
                        <th className="px-3 py-2.5 text-right font-medium">기대</th>
                        <th className="px-3 py-2.5 text-right font-medium">증분 ±95% CI</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/70">
                      {rows.map((r) => {
                        const significant = r.uplift_ci > 0 && Math.abs(r.uplift_revenue) > r.uplift_ci;
                        return (
                          <tr key={r.product_id} className="hover:bg-soft/50">
                            <td className="px-3 py-2.5">
                              <span className="text-ink">{r.base_name}</span>
                              {r.is_main && (
                                <span className="ml-1.5 rounded bg-brand-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                                  메인
                                </span>
                              )}
                              {r.cold_start && (
                                <span
                                  className="ml-1.5 rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning"
                                  title={`baseline 관측 ${r.observed_baseline_days}일 (14일 미만) — 측정 신뢰도 낮음`}
                                >
                                  신상품
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right text-ink-3">
                              {wonShort(r.baseline_daily_revenue)}
                              {!r.cold_start && r.observed_baseline_days > 0 && (
                                <span className="ml-1 text-[10px] text-ink-4">({r.observed_baseline_days}일)</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right text-ink-2">{wonShort(r.actual_revenue)}</td>
                            <td className="px-3 py-2.5 text-right text-ink-4">{wonShort(r.expected_revenue)}</td>
                            <td className={`px-3 py-2.5 text-right font-semibold ${r.uplift_revenue < 0 ? "text-danger" : "text-ink"}`}>
                              <div className="flex items-center justify-end gap-1">
                                <span>{wonShort(r.uplift_revenue)}</span>
                                {!significant && r.uplift_ci > 0 && !r.cold_start && (
                                  <span className="text-[10px] text-ink-4" title="증분이 baseline 변동성 범위 안 — 통계적으로 유의하지 않음">
                                    n.s.
                                  </span>
                                )}
                              </div>
                              {r.uplift_ci > 0 && !r.cold_start && (
                                <div className="text-[10px] font-normal text-ink-4">±{wonShort(r.uplift_ci)}</div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {rows.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-8 text-center text-ink-4">
                            캠페인 기간의 판매 데이터가 없습니다.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] text-ink-4">
                  baseline = 직전 8주 비캠페인 일자의 요일별 평균 (±2σ 트림). 추세 보정 적용. 95% CI는 baseline 변동성 기준.
                </p>
              </section>

              <section className="lg:col-span-2">
                <h2 className="mb-2 text-sm font-semibold text-ink-2">증분 Top 10 (검정=메인 · 회색=후광)</h2>
                <div className="rounded-2xl card-soft p-4">
                  <UpliftChart data={chartData} />
                </div>
                <div className="mt-4 rounded-2xl card-soft p-4">
                  <div className="text-xs text-ink-3">메인 상품</div>
                  {mains.length > 0 ? (
                    <ul className="mt-1.5 space-y-1 text-sm">
                      {mains.map((m) => (
                        <li key={m.product_id} className="flex justify-between">
                          <span className="truncate text-ink-2">{m.base_name}</span>
                          <span className="ml-2 shrink-0 text-ink-3">증분 {wonShort(m.uplift_revenue)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-ink-4">
                      아직 메인 상품이 지정되지 않았습니다.{" "}
                      <Link href={`/promotions/${id}/edit`} className="underline">
                        지정하기
                      </Link>
                    </p>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}

        {view === "skus" && (
          <div>
            <div className="mb-4 rounded-2xl card-soft p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-ink-2">가격 가이드(플랜)</h2>
                  {plan ? (
                    <p className="mt-1 text-sm text-ink-3">
                      v{plan.version} ·{" "}
                      <span className={plan.status === "confirmed" ? "text-success" : "text-warning"}>
                        {plan.status === "confirmed" ? "확정됨" : "draft"}
                      </span>{" "}
                      · 예상 매출 {won(plan.expected_revenue_total)} · 예상 공헌이익 {won(plan.expected_contribution_total)}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-ink-3">
                      아직 플랜이 없습니다. 옵션·예상 세트수로 예상 성과를 미리 계산하세요.
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

            {plan && (
              <section className="mb-4 rounded-2xl card-soft p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-ink-2">비교 대상 연결</h2>
                    {!plan.actual_promotion_id && (
                      <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning">
                        비교 대상 미지정
                      </span>
                    )}
                  </div>
                  <Link href={`/promotions/${id}/edit`} className="text-xs text-ink-4 hover:text-brand-600 hover:underline">
                    중복 캠페인이 있나요? 병합 도구 →
                  </Link>
                </div>
                {linkedActualName ? (
                  <p className="mt-1 text-xs text-ink-3">
                    비교 구도: <strong className="text-ink">이 캠페인의 플랜</strong> ↔{" "}
                    <strong className="text-brand-700">{linkedActualName}</strong> 실적.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-ink-4">
                    비교할 실적 캠페인을 지정하면 아래 달성 블록이 자동으로 채워집니다.
                  </p>
                )}
                <ActualsLink promotionId={id} currentLinkId={plan.actual_promotion_id} candidates={candidates} />
              </section>
            )}

            <Achievement
              promotionId={id}
              summary={achSummary}
              rows={achRows}
              options={achOptions}
              optionInfos={optionInfos}
              diagnosticRows={diagnosticRows}
              skuMappings={skuMappings}
              hideSummaryCards
            />
          </div>
        )}

        {view === "trend" && (
          <CampaignTrend
            data={bundle?.rollup?.daily ?? []}
            baselineDaily={
              bundle?.rollup?.features?.baseline_daily != null
                ? Number(bundle.rollup.features.baseline_daily)
                : null
            }
          />
        )}

        {view === "purpose" && <PurposeBlock rows={purposeRows} />}

        {view === "sources" && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <section className="lg:col-span-2">
              <h2 className="mb-2 text-sm font-semibold text-ink-2">데이터 출처 (업로드 파일)</h2>
              {sources.length > 0 ? (
                <ul className="space-y-1.5 rounded-2xl card-soft p-4 text-sm">
                  {sources.slice(0, 8).map((s) => (
                    <li key={s.id} className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-ink-2" title={s.source_file}>
                        {s.source_file}
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-4">
                        {s.kind === "plan_guide" ? "플랜" : s.kind === "promotion" ? "실적" : s.kind}
                        {" · "}
                        {new Date(s.created_at).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-2xl card-soft p-4 text-sm text-ink-4">출처 기록이 없습니다.</p>
              )}
            </section>
            <section className="lg:col-span-3">
              <h2 className="mb-1 text-sm font-semibold text-ink-2">성과의 원인 — 집요하게 묻기</h2>
              <p className="mb-3 text-xs text-ink-4">여기 쌓인 원인·가설이 예측 정확도를 높입니다.</p>
              <Notes promotionId={id} notes={notes} suggested={suggested} />
            </section>
          </div>
        )}
      </div>
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
  const significant = summary.uplift_ci > 0 && Math.abs(summary.total_uplift) > summary.uplift_ci;

  const chips: { label: string; tone: "neutral" | "warn" | "ok" }[] = [];
  if (Math.abs(trendPct) >= 1) {
    chips.push({ label: `추세 보정 ${trendPct > 0 ? "+" : ""}${trendPct.toFixed(1)}%`, tone: "neutral" });
  }
  if (cold > 0) chips.push({ label: `신상품 ${cold}건`, tone: "warn" });
  if (summary.uplift_ci > 0) {
    chips.push({ label: significant ? "통계적 유의" : "유의성 낮음", tone: significant ? "ok" : "warn" });
  }
  if (chips.length === 0) return null;

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl card-soft px-4 py-3">
      <span className="text-xs font-medium text-ink-3">측정 보정</span>
      {chips.map((c) => (
        <span
          key={c.label}
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
            c.tone === "ok"
              ? "bg-success-soft text-success"
              : c.tone === "warn"
                ? "bg-warning-soft text-warning"
                : "bg-soft text-ink-3"
          }`}
        >
          {c.label}
        </span>
      ))}
      <span className="text-[11px] text-ink-4">
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
    <div className={`rounded-xl border p-4 ${primary ? "border-transparent bg-brand-500 text-white" : "border-line bg-card"}`}>
      <div className={`text-xs ${primary ? "text-white/70" : "text-ink-3"}`}>{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {sub && <div className={`mt-0.5 text-xs ${primary ? "text-white/70" : "text-ink-4"}`}>{sub}</div>}
    </div>
  );
}

function buildQuestions(rows: MeasurementRow[], summary: PromotionSummary | null): string[] {
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
