"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { won, wonShort, num } from "@/lib/format";

// promo.sku_match_diagnostic() 반환 행
export type DiagnosticRow = {
  side: "both" | "plan" | "actual";
  product_id: string;
  base_name: string;
  dr_code: string | null;
  expected_qty: number | null;
  expected_revenue: number | null;
  actual_qty: number | null;
  actual_revenue: number | null;
  is_mapped: boolean;
};

export type SkuMapping = {
  plan_product_id: string;
  actual_product_id: string;
};

// 양쪽 SKU 리스트에서 선택해 수동 매핑하는 패널.
// product_id 가 다른 경로(가이드 임포터 ⑤ vs 실적 시트 ②)로 등록된 같은 SKU 를 연결.
export default function SkuMatchPanel({
  promotionId,
  rows,
  mappings,
}: {
  promotionId: string;
  rows: DiagnosticRow[];
  mappings: SkuMapping[];
}) {
  const router = useRouter();
  const [planPick, setPlanPick] = useState<string>("");
  const [actualPick, setActualPick] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const matched = rows.filter((r) => r.side === "both");
  const planOnly = rows.filter((r) => r.side === "plan");
  const actualOnly = rows.filter((r) => r.side === "actual");

  const mappingPairs = useMemo(() => {
    const byPlan = new Map<string, string[]>();
    for (const m of mappings) {
      const arr = byPlan.get(m.plan_product_id) ?? [];
      arr.push(m.actual_product_id);
      byPlan.set(m.plan_product_id, arr);
    }
    return byPlan;
  }, [mappings]);

  async function addMapping() {
    if (!planPick || !actualPick) return;
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/promotions/${promotionId}/sku-mappings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        plan_product_id: planPick,
        actual_product_id: actualPick,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "매핑 추가 실패");
      return;
    }
    setPlanPick("");
    setActualPick("");
    router.refresh();
  }

  async function removeMapping(plan_product_id: string, actual_product_id: string) {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/promotions/${promotionId}/sku-mappings`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan_product_id, actual_product_id }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "매핑 삭제 실패");
      return;
    }
    router.refresh();
  }

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-ink-2">SKU 매칭 진단</h2>
      <p className="mb-3 text-xs text-ink-4">
        플랜·실적 시트가 같은 SKU를 서로 다른 품목명/품목코드로 등록하면 자동 매칭이 안 됩니다.
        아래 양쪽 리스트에서 같은 SKU를 골라 수동 연동하세요. 매칭한 실적은 달성률 집계에 합산됩니다.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="자동 매칭됨" value={matched.length} tone="ok" />
        <Stat label="플랜만 (실적 없음)" value={planOnly.length} tone="warn" />
        <Stat label="실적만 (플랜 없음)" value={actualOnly.length} tone="warn" />
      </div>

      {/* 수동 매핑 추가 */}
      {(planOnly.length > 0 || actualOnly.length > 0) && (
        <div className="mt-4 rounded-[20px] bg-canvas p-4 card-soft">
          <h3 className="mb-2 text-xs font-semibold text-ink-2">수동 매핑 추가</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
            <select
              value={planPick}
              onChange={(e) => setPlanPick(e.target.value)}
              className="rounded-xl bg-canvas px-3 py-2 text-sm surface-pressed-soft focus:outline-none"
            >
              <option value="">플랜 SKU 선택 …</option>
              {planOnly.map((r) => (
                <option key={r.product_id} value={r.product_id}>
                  [{r.dr_code ?? "—"}] {r.base_name}
                </option>
              ))}
            </select>
            <span className="self-center text-center text-xs text-ink-4">↔</span>
            <select
              value={actualPick}
              onChange={(e) => setActualPick(e.target.value)}
              className="rounded-xl bg-canvas px-3 py-2 text-sm surface-pressed-soft focus:outline-none"
            >
              <option value="">실적 SKU 선택 …</option>
              {actualOnly.map((r) => (
                <option key={r.product_id} value={r.product_id}>
                  [{r.dr_code ?? "—"}] {r.base_name}
                </option>
              ))}
            </select>
            <button
              onClick={addMapping}
              disabled={busy || !planPick || !actualPick}
              className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
            >
              연동
            </button>
          </div>
          {err && <p className="mt-2 text-xs text-brand-700">{err}</p>}
        </div>
      )}

      {/* 현재 매핑 목록 */}
      {mappings.length > 0 && (
        <div className="mt-3 rounded-[20px] bg-canvas p-4 card-soft">
          <h3 className="mb-2 text-xs font-semibold text-ink-2">
            현재 매핑 ({mappings.length}건)
          </h3>
          <ul className="space-y-1.5 text-xs">
            {mappings.map((m) => {
              const planName =
                rows.find((r) => r.product_id === m.plan_product_id)?.base_name ??
                m.plan_product_id;
              return (
                <li
                  key={`${m.plan_product_id}-${m.actual_product_id}`}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate text-ink-2">
                    {planName}{" "}
                    <span className="text-ink-4">
                      ← actual {m.actual_product_id.slice(0, 8)}…
                    </span>
                  </span>
                  <button
                    onClick={() => removeMapping(m.plan_product_id, m.actual_product_id)}
                    disabled={busy}
                    className="text-xs text-ink-4 hover:text-brand-700"
                  >
                    해제
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* SKU 진단 표 */}
      <div className="mt-3 overflow-x-auto rounded-[20px] bg-canvas card-soft">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="text-left text-ink-4">
            <tr>
              <th className="px-3 py-2 font-medium">상태</th>
              <th className="px-3 py-2 font-medium">SKU</th>
              <th className="px-3 py-2 text-right font-medium">기대수량</th>
              <th className="px-3 py-2 text-right font-medium">기대매출</th>
              <th className="px-3 py-2 text-right font-medium">실수량</th>
              <th className="px-3 py-2 text-right font-medium">실매출</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const linked = (mappingPairs.get(r.product_id)?.length ?? 0) > 0;
              return (
                <tr
                  key={r.product_id}
                  className="border-t border-[var(--color-line)]/60"
                >
                  <td className="px-3 py-2">
                    <SideBadge side={r.side} isMapped={r.is_mapped || linked} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-ink">{r.base_name}</div>
                    {r.dr_code && (
                      <div className="text-[10px] text-ink-4">{r.dr_code}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-ink-3">
                    {r.expected_qty ? num(r.expected_qty) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-ink-3">
                    {r.expected_revenue ? wonShort(r.expected_revenue) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-ink-3">
                    {r.actual_qty ? num(r.actual_qty) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-ink-3">
                    {r.actual_revenue ? won(r.actual_revenue) : "—"}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-ink-4">
                  플랜·실적 모두 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn";
}) {
  const color = tone === "ok" ? "text-brand-600" : "text-ink-2";
  return (
    <div className="rounded-[20px] bg-canvas p-4 card-soft">
      <div className="text-[11px] font-semibold uppercase tracking-[1.4px] text-ink-4">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function SideBadge({
  side,
  isMapped,
}: {
  side: DiagnosticRow["side"];
  isMapped: boolean;
}) {
  if (side === "both") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-brand-700 surface-pressed-soft">
        {isMapped ? "매핑됨" : "자동 매칭"}
      </span>
    );
  }
  if (side === "plan") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-ink-3 surface-pressed-soft">
        플랜만
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-ink-3 surface-pressed-soft">
      실적만
    </span>
  );
}
