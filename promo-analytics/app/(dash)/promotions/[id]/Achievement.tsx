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

export default function Achievement({
  promotionId,
  summary,
  rows,
  options,
  optionInfos,
}: {
  promotionId: string;
  summary: PlanVsActualSummary | null;
  rows: PlanVsActualRow[];
  options: PlanVsActualOption[];
  optionInfos: string[];
}) {
  if (!summary || !summary.has_confirmed_plan) {
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

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-neutral-700">달성률 (계획 대비 실적)</h2>

      {/* 3종 카드 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <AchCard
          label="매출 달성률"
          ach={summary.ach_revenue}
          actual={summary.actual_revenue_total}
          expected={summary.expected_revenue_total}
          primary
        />
        <AchCard
          label="수량 달성률"
          ach={summary.ach_qty}
          actual={summary.actual_qty_total}
          expected={summary.expected_qty_total}
          isQty
          lowData={summary.quantity_reliable === false}
        />
        <AchCard
          label="공헌이익 달성률"
          ach={summary.ach_contribution}
          actual={summary.actual_contribution_total}
          expected={summary.expected_contribution_total}
        />
      </div>

      {/* SKU 단위 가이드 vs 실적 */}
      <div className="mt-4 overflow-x-auto rounded-2xl card-soft">
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

      {/* 옵션 단위 보조 */}
      <div className="mt-4">
        <h3 className="mb-1 text-xs font-semibold text-neutral-500">옵션 단위 (보조)</h3>
        <p className="mb-2 text-[11px] text-neutral-400">
          SKU 단위 매칭은 품목 코드 기준 자동 — 위 표에 반영됩니다. 옵션 단위는 옵션 라벨↔실적 옵션정보 부분일치로
          기본 매핑되며, 빗나간 옵션만 수동으로 보정하세요.
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

      {/* 계획 외 판매 */}
      {unplanned.length > 0 && (
        <details className="mt-4 rounded-xl bg-amber-50/60 p-4">
          <summary className="cursor-pointer text-sm font-medium text-amber-800">
            계획 외 판매 — {unplanned.length}개 SKU · 매출 {wonShort(summary.unplanned_revenue)} · 공헌{" "}
            {wonShort(summary.unplanned_contribution)}
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

function AchPct({ v }: { v: number | null }) {
  if (v == null) return <span className="text-neutral-300">—</span>;
  const color = v >= 1 ? "text-green-600" : v <= 0 ? "text-red-500" : "text-neutral-700";
  return <span className={color}>{pct(v, 0)}</span>;
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
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{opt.option_label}</span>
          {opt.matched ? (
            <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
              매칭됨
            </span>
          ) : (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              옵션 매핑 필요
            </span>
          )}
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
            {editing ? "닫기" : "매핑"}
          </button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 border-t border-neutral-100 pt-3">
          <p className="mb-2 text-xs text-neutral-500">
            이 옵션에 해당하는 실적 옵션정보를 선택하세요 (부분일치).
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
