"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  PlanVsActualRow,
  PlanVsActualSummary,
  PlanVsActualOption,
} from "@/lib/types";
import { won, wonShort, pct, num } from "@/lib/format";
import SkuMatchPanel, { type DiagnosticRow, type SkuMapping } from "./SkuMatchPanel";

// N7 P3: 달성 & 매칭을 한 블록으로 통합.
// - 상단: SKU 기준 총 달성률 카드 (1차 진실)
// - 탭: SKU(품목) = 기본·신뢰 / 옵션(묶음) = 구성·묶음 best-effort 보기
// - SKU 탭에 SKU 매칭 패널을 흡수 (이전엔 별도 '연동 센터'로 분리돼 혼란)
export default function Achievement({
  promotionId,
  summary,
  rows,
  options,
  optionInfos,
  diagnosticRows,
  skuMappings,
}: {
  promotionId: string;
  summary: PlanVsActualSummary | null;
  rows: PlanVsActualRow[];
  options: PlanVsActualOption[];
  optionInfos: string[];
  diagnosticRows: DiagnosticRow[];
  skuMappings: SkuMapping[];
}) {
  const [tab, setTab] = useState<"sku" | "option">("sku");

  const hasConfirmed = !!summary?.has_confirmed_plan;
  const hasMatchData = diagnosticRows.length > 0 || skuMappings.length > 0;

  if (!hasConfirmed && !hasMatchData && options.length === 0) {
    return (
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">달성률 (계획 대비 실적)</h2>
        <div className="rounded-2xl card-soft p-6 text-sm text-neutral-500">
          확정된 가격 가이드(플랜)가 없습니다.{" "}
          <Link href={`/promotions/${promotionId}/plan`} className="text-brand-600 hover:underline">
            플랜을 확정
          </Link>
          하면 SKU·옵션 단위 달성률이 표시됩니다.
        </div>
      </section>
    );
  }

  const planRows = rows.filter((r) => r.status !== "unplanned");
  const unplanned = rows.filter((r) => r.status === "unplanned");
  const unmatched = diagnosticRows.filter((r) => r.side !== "both" && !r.is_mapped).length;

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-neutral-700">달성 & 매칭 (계획 대비 실적)</h2>

      {/* 달성 카드 (N8 매출 중심): 매출은 전체 실적/목표, 수량은 메인 제품 */}
      {hasConfirmed ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <AchCard
              label="캠페인 매출 달성 (전체)"
              ach={summary!.revenue_ach_total}
              actual={summary!.campaign_revenue_total}
              expected={summary!.expected_revenue_total}
              primary
            />
            <AchCard
              label="메인 제품 수량 달성"
              ach={summary!.ach_qty}
              actual={summary!.actual_qty_total}
              expected={summary!.expected_qty_total}
              isQty
              lowData={summary!.quantity_reliable === false}
            />
            <AchCard
              label="공헌이익 달성 (전체)"
              ach={summary!.contribution_ach_total}
              actual={summary!.contribution_total}
              expected={summary!.expected_contribution_total}
            />
          </div>
          {/* 매출 구성: 메인 + 함께 구매 (구독 제외) */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-soft px-4 py-2.5 text-[11px] text-ink-3">
            <span>
              메인 제품 매출 <strong className="text-ink">{wonShort(summary!.main_revenue)}</strong>
            </span>
            <span className="text-ink-4">＋</span>
            <span>
              함께 구매 매출{" "}
              <strong className="text-brand-700">{wonShort(summary!.halo_revenue)}</strong>
              <span className="text-ink-4"> (메인 외 동반구매)</span>
            </span>
            <span className="text-ink-4">＝</span>
            <span>
              전체 <strong className="text-ink">{wonShort(summary!.campaign_revenue_total)}</strong>
            </span>
            {(summary!.subscription_revenue ?? 0) > 0 && (
              <span className="text-ink-4">· 구독 {wonShort(summary!.subscription_revenue)} 제외</span>
            )}
          </div>
        </>
      ) : (
        <p className="rounded-xl card-soft px-4 py-3 text-xs text-neutral-500">
          확정 플랜이 아니라 총 달성률은 미표시 — 아래에서 SKU 매칭만 정리할 수 있습니다.{" "}
          <Link href={`/promotions/${promotionId}/plan`} className="text-brand-600 hover:underline">
            플랜 확정 →
          </Link>
        </p>
      )}

      {/* 탭: SKU(품목) 기본 / 옵션(묶음) 보조 */}
      <div className="mt-4 inline-flex rounded-xl bg-soft p-1 text-xs font-medium">
        <button
          onClick={() => setTab("sku")}
          className={`rounded-lg px-3 py-1.5 ${tab === "sku" ? "bg-card text-ink shadow-sm" : "text-ink-3"}`}
        >
          SKU(품목)
          {unmatched > 0 && (
            <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
              미매칭 {unmatched}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("option")}
          className={`rounded-lg px-3 py-1.5 ${tab === "option" ? "bg-card text-ink shadow-sm" : "text-ink-3"}`}
        >
          옵션(묶음){options.length > 0 ? ` ${options.length}` : ""}
        </button>
      </div>

      {tab === "sku" ? (
        <div className="mt-3">
          <p className="mb-2 text-[11px] text-neutral-400">
            매출 달성은 위 카드의 <strong>캠페인 전체(함께 구매 포함)</strong> 기준입니다. 여기 SKU 표는 <strong>메인 제품이 예상수량만큼 팔렸는지</strong>를 봅니다 — 품목 코드·정규화 이름으로 자동 매칭, 빗나간 것만 아래에서 보정하세요.
          </p>

          {/* 메인 제품 예상 vs 실제 수량 — 막대 + 부족분 강조 (한눈에) */}
          {hasConfirmed && planRows.length > 0 && (
            <div className="mb-3 rounded-2xl card-soft p-4">
              <div className="mb-2.5 text-xs font-medium text-ink-2">메인 제품 수량: 예상 vs 실제</div>
              <ul className="space-y-2.5">
                {planRows.map((r) => (
                  <QtyBar key={r.product_id} row={r} />
                ))}
              </ul>
            </div>
          )}

          {/* SKU 단위 가이드 vs 실적 */}
          {hasConfirmed && (
            <div className="overflow-x-auto rounded-2xl card-soft">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">SKU</th>
                    <th className="px-3 py-2.5 text-right font-medium">기대 매출</th>
                    <th className="px-3 py-2.5 text-right font-medium">실 매출</th>
                    <th className="px-3 py-2.5 text-right font-medium">매출 달성</th>
                    <th className="px-3 py-2.5 text-right font-medium">기대 수량</th>
                    <th className="px-3 py-2.5 text-right font-medium">실 수량</th>
                    <th className="px-3 py-2.5 text-right font-medium">공헌 달성</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {planRows.map((r) => (
                    <tr key={r.product_id} className={r.status === "unsold" ? "bg-red-50/40" : ""}>
                      <td className="px-3 py-2.5">
                        {r.base_name}
                        {r.status === "unsold" && (
                          <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                            미판매
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-neutral-500">{won(r.expected_revenue)}</td>
                      <td className="px-3 py-2.5 text-right">{won(r.actual_revenue)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <AchPct v={r.ach_revenue} />
                      </td>
                      <td className="px-3 py-2.5 text-right text-neutral-500">{num(r.expected_qty)}</td>
                      <td className="px-3 py-2.5 text-right">{num(r.actual_qty)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <AchPct v={r.ach_contribution} />
                      </td>
                    </tr>
                  ))}
                  {planRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-4 text-center text-xs text-neutral-400">
                        계획된 SKU가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* SKU 매칭 패널 (이전 '연동 센터'에서 흡수) */}
          {hasMatchData && (
            <SkuMatchPanel promotionId={promotionId} rows={diagnosticRows} mappings={skuMappings} />
          )}

          {/* 계획 외 판매 */}
          {hasConfirmed && unplanned.length > 0 && (
            <details className="mt-4 rounded-xl bg-amber-50/60 p-4">
              <summary className="cursor-pointer text-sm font-medium text-amber-800">
                계획 외 판매 — {unplanned.length}개 SKU · 매출 {wonShort(summary!.unplanned_revenue)} · 공헌{" "}
                {wonShort(summary!.unplanned_contribution)}
                <span className="ml-1 text-xs font-normal text-amber-600">
                  (전체 달성률 분모에서 제외)
                </span>
              </summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-amber-700/70">
                    <tr>
                      <th className="py-1 pr-3">SKU</th>
                      <th className="py-1 pr-3 text-right">실 매출</th>
                      <th className="py-1 text-right">실 수량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unplanned.map((r) => (
                      <tr key={r.product_id} className="border-t border-amber-100">
                        <td className="py-1 pr-3">{r.base_name}</td>
                        <td className="py-1 pr-3 text-right">{won(r.actual_revenue)}</td>
                        <td className="py-1 text-right">{num(r.actual_qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <p className="mb-2 text-[11px] text-neutral-400">
            옵션(묶음) 달성은 <strong>구성·묶음수 기반 best-effort</strong> 입니다 — 실적 옵션정보가 자유 텍스트라 완전 매칭은 불가하며,
            같은 구성의 중복 옵션엔 매출을 분배해 보여줍니다. 신뢰 기준은 위 SKU 탭입니다.
          </p>
          <div className="space-y-2">
            {options.map((o) => (
              <OptionRow
                key={o.option_id}
                promotionId={promotionId}
                opt={o}
                optionInfos={optionInfos}
              />
            ))}
            {options.length === 0 && (
              <p className="text-xs text-neutral-400">옵션이 없습니다.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function AchCard({
  label,
  ach,
  actual,
  expected,
  primary,
  isQty,
  lowData,
}: {
  label: string;
  ach: number | null;
  actual: number | null;
  expected: number | null;
  primary?: boolean;
  isQty?: boolean;
  lowData?: boolean;
}) {
  const fmt = isQty ? num : wonShort;
  return (
    <div className={`rounded-xl p-4 ${primary ? "bg-brand-50" : "card-soft"}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-neutral-500">{label}</span>
        {lowData && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
            데이터 부족
          </span>
        )}
      </div>
      <div className="mt-1 text-2xl font-semibold">
        {ach != null ? pct(ach, 0) : "—"}
      </div>
      <div className="mt-0.5 text-xs text-neutral-400">
        {fmt(actual)} / {fmt(expected)}
      </div>
    </div>
  );
}

// 메인 제품 예상 vs 실제 수량 막대 — 달성률·부족분 강조
function QtyBar({ row }: { row: PlanVsActualRow }) {
  const exp = row.expected_qty ?? 0;
  const act = row.actual_qty ?? 0;
  const ratio = exp > 0 ? act / exp : null;
  const fill = exp > 0 ? Math.min(100, (act / exp) * 100) : act > 0 ? 100 : 0;
  const over = ratio != null && ratio >= 1;
  const short = exp - act;
  return (
    <li>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate text-ink-2" title={row.base_name}>
          {row.base_name}
        </span>
        <span className="shrink-0 tabular-nums text-ink-3">
          {num(act)} / {num(exp)}
          {ratio != null && (
            <span className={`ml-1.5 font-semibold ${over ? "text-green-600" : "text-amber-600"}`}>
              {pct(ratio, 0)}
            </span>
          )}
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
        <div
          className={`h-full rounded-full ${over ? "bg-green-500" : "bg-amber-400"}`}
          style={{ width: `${fill}%` }}
        />
      </div>
      {!over && exp > 0 && short > 0 && (
        <div className="mt-0.5 text-[10px] font-medium text-amber-600">
          예상 대비 {num(short)}개 부족
        </div>
      )}
    </li>
  );
}

function AchPct({ v }: { v: number | null }) {
  if (v == null) return <span className="text-neutral-300">—</span>;
  const color = v >= 1 ? "text-green-600" : v <= 0 ? "text-red-500" : "text-neutral-700";
  return <span className={color}>{pct(v, 0)}</span>;
}

// 매칭 출처 배지 — best-effort 신뢰도를 한눈에
function SourceBadge({ src }: { src: PlanVsActualOption["match_source"] }) {
  if (src === "routed")
    return (
      <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
        자동 (구성·묶음)
      </span>
    );
  if (src === "manual")
    return (
      <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">
        수동 매핑
      </span>
    );
  return (
    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">
      미매칭
    </span>
  );
}

function OptionRow({
  promotionId,
  opt,
  optionInfos,
}: {
  promotionId: string;
  opt: PlanVsActualOption;
  optionInfos: string[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(opt.match_patterns ?? []);
  const [busy, setBusy] = useState(false);

  function toggle(info: string) {
    setSelected((prev) =>
      prev.includes(info) ? prev.filter((x) => x !== info) : [...prev, info],
    );
  }

  async function saveMapping() {
    setBusy(true);
    const res = await fetch(
      `/api/promotions/${promotionId}/plan/options/${opt.option_id}/mapping`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ match_patterns: selected }),
      },
    );
    setBusy(false);
    if (res.ok) {
      setEditing(false);
      router.refresh();
    }
  }

  return (
    <div className="rounded-[16px] card-soft p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* 구성·묶음·세트가 노출 — 라벨 단독 금지 (2개입/6개입 구분) */}
          <span className="min-w-0 text-sm font-medium text-ink" title={opt.option_label}>
            {opt.display_label ?? opt.option_label}
          </span>
          <SourceBadge src={opt.match_source} />
        </div>
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          <span>
            예상 {wonShort(opt.expected_revenue)} → 실적 {wonShort(opt.actual_revenue)}
          </span>
          <span className="font-medium">
            <AchPct v={opt.ach_revenue} />
          </span>
          <button
            onClick={() => setEditing((v) => !v)}
            className="rounded-lg border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-50"
          >
            {editing ? "닫기" : "수동 보정"}
          </button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 border-t border-neutral-100 pt-3">
          <p className="mb-2 text-xs text-neutral-500">
            자동(구성·묶음) 라우팅이 빗나갔다면, 이 옵션에 해당하는 실적 옵션정보를 직접 고르세요 (부분일치). 저장 시 수동 매핑이 우선합니다.
          </p>
          {optionInfos.length === 0 ? (
            <p className="text-xs text-neutral-400">
              실적 데이터에 옵션정보가 없습니다. (수량·옵션 컬럼 미보유)
            </p>
          ) : (
            <div className="max-h-56 space-y-1 overflow-auto">
              {optionInfos.map((info) => (
                <label key={info} className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selected.includes(info)}
                    onChange={() => toggle(info)}
                  />
                  <span className="break-all">{info}</span>
                </label>
              ))}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={saveMapping}
              disabled={busy}
              className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              매핑 저장
            </button>
            <span className="self-center text-[11px] text-neutral-400">
              확정 플랜이어도 매핑은 수정 가능합니다.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
