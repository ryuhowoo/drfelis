"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
  is_subscription: boolean;
};

export type SkuMapping = {
  plan_product_id: string;
  actual_product_id: string;
};

// SQL promo.normalize_sku_name(0018) 의 클라이언트 미러 — 추천 정렬용(표시 전용).
// 실제 매칭 판정은 항상 서버가 한다.
function normalize(name: string): string {
  return name
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/닥터펠리스/g, "")
    .replace(/[\s\-_·.,/+]/g, "")
    .toLowerCase();
}

// 추천 점수: 정규화 동일 > 포함 > 공통 prefix 길이
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1000;
  if (na.includes(nb) || nb.includes(na)) return 500 + Math.min(na.length, nb.length);
  let i = 0;
  while (i < Math.min(na.length, nb.length) && na[i] === nb[i]) i++;
  return i;
}

// 플랜 ↔ 실적 SKU 매칭 패널 (N6 비교 UX 개편판).
// - 미매칭 플랜 SKU 마다 행 안에서 바로 실적 SKU 를 골라 연동 (왕복 제거)
// - 실적 후보는 이름 유사도순 정렬, 최상위 후보 '추천' 표기
// - 요약은 카드 대신 칩 한 줄, 진단 표는 검색 필터 지원
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
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({}); // plan pid → actual pid
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const matched = rows.filter((r) => r.side === "both");
  const planOnly = rows.filter((r) => r.side === "plan" && !r.is_mapped);
  const actualOnly = rows.filter((r) => r.side === "actual" && !r.is_mapped);
  const nameOf = useMemo(() => {
    const m = new Map(rows.map((r) => [r.product_id, r.base_name]));
    return (pid: string) => m.get(pid) ?? `${pid.slice(0, 8)}…`;
  }, [rows]);

  async function addMapping(planPid: string, actualPid: string) {
    if (!actualPid) return;
    setBusyKey(planPid);
    const res = await fetch(`/api/promotions/${promotionId}/sku-mappings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan_product_id: planPid, actual_product_id: actualPid }),
    });
    setBusyKey(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "연동 실패", {
        action: { label: "다시 시도", onClick: () => addMapping(planPid, actualPid) },
      });
      return;
    }
    toast.success(`${nameOf(planPid)} 연동됨`);
    router.refresh();
  }

  async function toggleSubscription(productId: string, next: boolean) {
    setBusyKey(productId);
    const res = await fetch(`/api/products/subscription`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ product_id: productId, is_subscription: next }),
    });
    setBusyKey(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "구독 지정 실패");
      return;
    }
    toast.success(next ? "정기구독으로 지정됨" : "정기구독 해제됨");
    router.refresh();
  }

  async function removeMapping(plan_product_id: string, actual_product_id: string) {
    setBusyKey(plan_product_id);
    const res = await fetch(`/api/promotions/${promotionId}/sku-mappings`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan_product_id, actual_product_id }),
    });
    setBusyKey(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "해제 실패");
      return;
    }
    router.refresh();
  }

  const filtered = query.trim()
    ? rows.filter(
        (r) =>
          r.base_name.includes(query.trim()) ||
          (r.dr_code ?? "").includes(query.trim()),
      )
    : rows;

  return (
    <section className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-2">SKU 매칭</h3>
        {/* 요약 칩 한 줄 — 큰 카드 3개 대체 */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
            자동 {matched.filter((r) => !r.is_mapped).length}
          </span>
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">
            수동 {mappings.length}
          </span>
          {planOnly.length > 0 && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
              플랜 미매칭 {planOnly.length}
            </span>
          )}
          {actualOnly.length > 0 && (
            <span className="rounded-full bg-soft px-2 py-0.5 text-ink-3">
              실적 미매칭 {actualOnly.length}
            </span>
          )}
        </div>
      </div>

      {/* 미매칭 플랜 SKU — 행 안에서 바로 연동 */}
      {planOnly.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-xl card-soft">
          <div className="border-b border-line bg-amber-50/50 px-4 py-2.5 text-xs font-medium text-amber-800">
            플랜에 있는데 실적과 매칭 안 된 SKU {planOnly.length}개 — 행에서 바로
            실적 SKU를 골라 연동하세요 (추천순 정렬)
          </div>
          <ul className="divide-y divide-line/70">
            {planOnly.map((p) => {
              const candidates = [...actualOnly].sort(
                (a, b) =>
                  similarity(p.base_name, b.base_name) -
                  similarity(p.base_name, a.base_name),
              );
              const best = candidates[0];
              const bestScore = best ? similarity(p.base_name, best.base_name) : 0;
              const pick = picks[p.product_id] ?? (bestScore >= 500 ? best.product_id : "");
              return (
                <li
                  key={p.product_id}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 sm:w-2/5">
                    <div className="truncate text-sm text-ink" title={p.base_name}>
                      {p.base_name}
                    </div>
                    <div className="text-[10px] text-ink-4">
                      {p.dr_code ?? "코드 없음"} · 기대 {num(p.expected_qty)}개 ·{" "}
                      {wonShort(p.expected_revenue)}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <select
                      value={pick}
                      onChange={(e) =>
                        setPicks((s) => ({ ...s, [p.product_id]: e.target.value }))
                      }
                      className="w-full min-w-0 flex-1 truncate rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink-2 focus:outline-none"
                    >
                      <option value="">실적 SKU 선택…</option>
                      {candidates.map((c, i) => (
                        <option key={c.product_id} value={c.product_id}>
                          {i === 0 && bestScore >= 500 ? "★ " : ""}
                          {c.base_name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => addMapping(p.product_id, pick)}
                      disabled={!pick || busyKey === p.product_id}
                      className="shrink-0 rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
                    >
                      {busyKey === p.product_id ? "…" : "연동"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 수동 매핑 현황 */}
      {mappings.length > 0 && (
        <div className="mt-3 rounded-xl card-soft px-4 py-3">
          <h4 className="text-xs font-semibold text-ink-2">수동 연동 {mappings.length}건</h4>
          <ul className="mt-1.5 space-y-1 text-xs">
            {mappings.map((m) => (
              <li
                key={`${m.plan_product_id}-${m.actual_product_id}`}
                className="flex items-center justify-between gap-2"
              >
                <span className="min-w-0 truncate text-ink-2">
                  {nameOf(m.plan_product_id)}{" "}
                  <span className="text-ink-4">↔ {nameOf(m.actual_product_id)}</span>
                </span>
                <button
                  onClick={() => removeMapping(m.plan_product_id, m.actual_product_id)}
                  disabled={busyKey != null}
                  className="shrink-0 text-[11px] text-ink-4 hover:text-brand-700"
                >
                  해제
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 전체 진단 표 — 접이식 + 검색 */}
      <div className="mt-3 rounded-xl card-soft">
        <button
          onClick={() => setShowAll((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold text-ink-2"
        >
          전체 SKU 진단 표 ({rows.length})
          <span className="text-ink-4">{showAll ? "접기 ▴" : "펼치기 ▾"}</span>
        </button>
        {showAll && (
          <div className="border-t border-line/70 px-4 pb-4">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="SKU 이름·코드 검색…"
              className="mt-3 w-full rounded-xl border border-line bg-card px-3 py-2 text-sm focus:outline-none sm:max-w-xs"
            />
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="text-left text-ink-4">
                  <tr>
                    <th className="px-2 py-2 font-medium">상태</th>
                    <th className="px-2 py-2 font-medium">SKU</th>
                    <th className="px-2 py-2 text-right font-medium">기대수량</th>
                    <th className="px-2 py-2 text-right font-medium">기대매출</th>
                    <th className="px-2 py-2 text-right font-medium">실수량</th>
                    <th className="px-2 py-2 text-right font-medium">실매출</th>
                    <th className="px-2 py-2 text-center font-medium">정기구독</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.product_id} className="border-t border-line/60">
                      <td className="px-2 py-2">
                        <SideBadge side={r.side} isMapped={r.is_mapped} />
                      </td>
                      <td className="px-2 py-2">
                        <div className="text-ink">{r.base_name}</div>
                        {r.dr_code && (
                          <div className="text-[10px] text-ink-4">{r.dr_code}</div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right text-ink-3">
                        {r.expected_qty ? num(r.expected_qty) : "—"}
                      </td>
                      <td className="px-2 py-2 text-right text-ink-3">
                        {r.expected_revenue ? wonShort(r.expected_revenue) : "—"}
                      </td>
                      <td className="px-2 py-2 text-right text-ink-3">
                        {r.actual_qty ? num(r.actual_qty) : "—"}
                      </td>
                      <td className="px-2 py-2 text-right text-ink-3">
                        {r.actual_revenue ? won(r.actual_revenue) : "—"}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button
                          onClick={() => toggleSubscription(r.product_id, !r.is_subscription)}
                          disabled={busyKey === r.product_id}
                          title="정기구독 상품으로 지정하면 달성률에서 제외되고 별도 표기됩니다"
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            r.is_subscription
                              ? "bg-violet-100 text-violet-700"
                              : "bg-soft text-ink-4 hover:text-ink-2"
                          }`}
                        >
                          {r.is_subscription ? "✓ 구독" : "구독 지정"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-2 py-6 text-center text-ink-4">
                        {query ? "검색 결과가 없습니다." : "플랜·실적 모두 없습니다."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SideBadge({
  side,
  isMapped,
}: {
  side: DiagnosticRow["side"];
  isMapped: boolean;
}) {
  if (side === "both" || isMapped) {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
        {isMapped ? "수동 연동" : "자동 매칭"}
      </span>
    );
  }
  if (side === "plan") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
        플랜만
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-soft px-2 py-0.5 text-[10px] font-semibold text-ink-3">
      실적만
    </span>
  );
}
