"use client";

import { useEffect, useMemo, useState } from "react";
import { won, wonShort, num } from "@/lib/format";
import { cn } from "@/lib/cn";
import { StatusBadge } from "@/components/ui";
import { useOptimisticMutation } from "@/hooks/useOptimisticMutation";
import { useTableSort } from "@/lib/table-sort";

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
  is_subscription: boolean; // 라인 파생(상시/구독 분리) — 섞인 제품은 2행
  is_subscription_override: boolean; // products.is_subscription(수동 전체지정)
};

export type SkuMapping = { plan_product_id: string; actual_product_id: string };

// SQL normalize_sku_name 의 클라이언트 미러 — 추천 정렬·신뢰도 표시용. 판정은 서버가.
function normalize(name: string): string {
  return name
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/(닥터펠리스|세븐플러스)/g, "")
    .replace(/[\s\-_·.,/+]/g, "")
    .toLowerCase();
}
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
// 신뢰도 라벨 (지시서 §3: 정확/추천/미매칭)
function confidence(score: number): { label: string; tone: "success" | "info" | "neutral" } | null {
  if (score >= 1000) return { label: "정확 추천", tone: "success" };
  if (score >= 500) return { label: "유사 추천", tone: "info" };
  if (score > 0) return { label: "약한 후보", tone: "neutral" };
  return null;
}

export default function SkuMatchPanel({
  promotionId,
  rows,
  mappings,
}: {
  promotionId: string;
  rows: DiagnosticRow[];
  mappings: SkuMapping[];
}) {
  const { run, pending } = useOptimisticMutation();
  // optimistic 로컬 상태 — 서버 reconcile(props 변경) 시 재동기화
  const [localRows, setLocalRows] = useState(rows);
  const [localMaps, setLocalMaps] = useState(mappings);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => setLocalRows(rows), [rows]);
  useEffect(() => setLocalMaps(mappings), [mappings]);

  const matched = localRows.filter((r) => r.side === "both" || r.is_mapped);
  const planOnly = localRows.filter((r) => r.side === "plan" && !r.is_mapped);
  const actualOnly = localRows.filter((r) => r.side === "actual" && !r.is_mapped);
  const nameOf = useMemo(() => {
    const m = new Map(localRows.map((r) => [r.product_id, r.base_name]));
    return (pid: string) => m.get(pid) ?? `${pid.slice(0, 8)}…`;
  }, [localRows]);

  const setMapped = (pids: string[], val: boolean) =>
    setLocalRows((rs) => rs.map((r) => (pids.includes(r.product_id) ? { ...r, is_mapped: val } : r)));

  function addMapping(planPid: string, actualPid: string) {
    if (!actualPid) return;
    const snapRows = localRows;
    const snapMaps = localMaps;
    run({
      key: `add:${planPid}`,
      apply: () => {
        setMapped([planPid, actualPid], true);
        setLocalMaps((m) => [...m, { plan_product_id: planPid, actual_product_id: actualPid }]);
        setFlash(planPid);
        setTimeout(() => setFlash((f) => (f === planPid ? null : f)), 600);
      },
      rollback: () => {
        setLocalRows(snapRows);
        setLocalMaps(snapMaps);
      },
      request: () =>
        fetch(`/api/promotions/${promotionId}/sku-mappings`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ plan_product_id: planPid, actual_product_id: actualPid }),
        }),
      successMessage: `${nameOf(planPid)} 연동됨`,
      errorMessage: "연동 실패",
      undo: () => removeMapping(planPid, actualPid),
    });
  }

  function removeMapping(planPid: string, actualPid: string) {
    const snapRows = localRows;
    const snapMaps = localMaps;
    run({
      key: `rm:${planPid}`,
      apply: () => {
        setMapped([planPid, actualPid], false);
        setLocalMaps((m) =>
          m.filter((x) => !(x.plan_product_id === planPid && x.actual_product_id === actualPid)),
        );
      },
      rollback: () => {
        setLocalRows(snapRows);
        setLocalMaps(snapMaps);
      },
      request: () =>
        fetch(`/api/promotions/${promotionId}/sku-mappings`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ plan_product_id: planPid, actual_product_id: actualPid }),
        }),
      successMessage: "연동 해제됨",
      errorMessage: "해제 실패",
    });
  }

  // 제품 전체 구독 오버라이드 토글 (products.is_subscription). 자동 감지(개월)와 별개.
  function toggleSubscription(pid: string, next: boolean) {
    const snap = localRows;
    run({
      key: `sub:${pid}`,
      apply: () =>
        setLocalRows((rs) =>
          rs.map((r) =>
            r.product_id === pid ? { ...r, is_subscription: next, is_subscription_override: next } : r,
          ),
        ),
      rollback: () => setLocalRows(snap),
      request: () =>
        fetch(`/api/products/subscription`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ product_id: pid, is_subscription: next }),
        }),
      successMessage: next ? "정기구독으로 지정됨" : "정기구독 해제됨",
      errorMessage: "구독 지정 실패",
    });
  }

  const filtered = query.trim()
    ? localRows.filter(
        (r) => r.base_name.includes(query.trim()) || (r.dr_code ?? "").includes(query.trim()),
      )
    : localRows;
  const { sorted: sortedRows, toggle: sortBy, arrow } = useTableSort<DiagnosticRow>(filtered, null, "desc");

  return (
    <section className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-2">SKU 매칭</h3>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
          <span className="rounded-full bg-success-soft px-2 py-0.5 text-success">
            자동 {matched.filter((r) => !r.is_mapped).length}
          </span>
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">수동 {localMaps.length}</span>
          {planOnly.length > 0 && (
            <span className="rounded-full bg-warning-soft px-2 py-0.5 text-warning">플랜 미매칭 {planOnly.length}</span>
          )}
          {actualOnly.length > 0 && (
            <span className="rounded-full bg-soft px-2 py-0.5 text-ink-3">성과 미매칭 {actualOnly.length}</span>
          )}
        </div>
      </div>

      {/* 미매칭 플랜 SKU — 행 안에서 바로 연동 (optimistic) */}
      {planOnly.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-xl card-soft">
          <div className="border-b border-line bg-warning-soft/60 px-4 py-2.5 text-xs font-medium text-warning">
            플랜에 있는데 성과와 매칭 안 된 SKU {planOnly.length}개 — 추천순으로 골라 바로 연동하세요.
          </div>
          <ul className="divide-y divide-line/70">
            {planOnly.map((p) => {
              const candidates = [...actualOnly].sort(
                (a, b) => similarity(p.base_name, b.base_name) - similarity(p.base_name, a.base_name),
              );
              const best = candidates[0];
              const bestScore = best ? similarity(p.base_name, best.base_name) : 0;
              const pick = picks[p.product_id] ?? (bestScore >= 500 ? best.product_id : "");
              const conf = pick ? confidence(similarity(p.base_name, nameOf(pick))) : null;
              const busy = pending === `add:${p.product_id}`;
              return (
                <li key={p.product_id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 sm:w-2/5">
                    <div className="truncate text-sm text-ink" title={p.base_name}>
                      {p.base_name}
                    </div>
                    <div className="text-[10px] text-ink-4">
                      {p.dr_code ?? "코드 없음"} · 기대 {num(p.expected_qty)}개 · {wonShort(p.expected_revenue)}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <select
                      value={pick}
                      aria-label={`${p.base_name}에 연결할 성과 SKU`}
                      onChange={(e) => setPicks((s) => ({ ...s, [p.product_id]: e.target.value }))}
                      className="w-full min-w-0 flex-1 truncate rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink-2 focus:outline-none"
                    >
                      <option value="">성과 SKU 선택…</option>
                      {candidates.map((c, i) => (
                        <option key={c.product_id} value={c.product_id}>
                          {i === 0 && bestScore >= 500 ? "★ " : ""}
                          {c.base_name}
                        </option>
                      ))}
                    </select>
                    {conf && <StatusBadge tone={conf.tone} label={conf.label} />}
                    <button
                      onClick={() => addMapping(p.product_id, pick)}
                      disabled={!pick || busy}
                      className="shrink-0 rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
                    >
                      {busy ? "…" : "연동"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 수동 매핑 현황 */}
      {localMaps.length > 0 && (
        <div className="mt-3 rounded-xl card-soft px-4 py-3">
          <h4 className="text-xs font-semibold text-ink-2">수동 연동 {localMaps.length}건</h4>
          <ul className="mt-1.5 space-y-1 text-xs">
            {localMaps.map((m) => (
              <li
                key={`${m.plan_product_id}-${m.actual_product_id}`}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md px-1",
                  flash === m.plan_product_id && "row-success-flash",
                )}
              >
                <span className="min-w-0 truncate text-ink-2">
                  {nameOf(m.plan_product_id)} <span className="text-ink-4">↔ {nameOf(m.actual_product_id)}</span>
                </span>
                <button
                  onClick={() => removeMapping(m.plan_product_id, m.actual_product_id)}
                  disabled={pending === `rm:${m.plan_product_id}`}
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
          aria-expanded={showAll}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold text-ink-2"
        >
          전체 SKU 진단 표 ({localRows.length})
          <span className="text-ink-4">{showAll ? "접기 ▴" : "펼치기 ▾"}</span>
        </button>
        {showAll && (
          <div className="border-t border-line/70 px-4 pb-4">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="SKU 이름·코드 검색…"
              aria-label="SKU 검색"
              className="mt-3 w-full rounded-xl border border-line bg-card px-3 py-2 text-sm focus:outline-none sm:max-w-xs"
            />
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="text-left text-ink-4">
                  <tr className="[&_th]:cursor-pointer [&_th]:select-none [&_th:hover]:text-ink-2">
                    <th className="px-2 py-2 font-medium" onClick={() => sortBy("side")}>상태{arrow("side")}</th>
                    <th className="px-2 py-2 font-medium" onClick={() => sortBy("base_name")}>SKU{arrow("base_name")}</th>
                    <th className="px-2 py-2 text-right font-medium" onClick={() => sortBy("expected_qty")}>기대수량{arrow("expected_qty")}</th>
                    <th className="px-2 py-2 text-right font-medium" onClick={() => sortBy("expected_revenue")}>기대매출{arrow("expected_revenue")}</th>
                    <th className="px-2 py-2 text-right font-medium" onClick={() => sortBy("actual_qty")}>성과수량{arrow("actual_qty")}</th>
                    <th className="px-2 py-2 text-right font-medium" onClick={() => sortBy("actual_revenue")}>성과매출{arrow("actual_revenue")}</th>
                    <th className="px-2 py-2 text-center font-medium">정기구독</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <tr key={`${r.product_id}:${r.is_subscription}`} className="border-t border-line/60">
                      <td className="px-2 py-2">
                        <SideBadge side={r.side} isMapped={r.is_mapped} />
                      </td>
                      <td className="px-2 py-2">
                        <div className="text-ink">{r.base_name}</div>
                        {r.dr_code && <div className="text-[10px] text-ink-4">{r.dr_code}</div>}
                      </td>
                      <td className="px-2 py-2 text-right text-ink-3">{r.expected_qty ? num(r.expected_qty) : "—"}</td>
                      <td className="px-2 py-2 text-right text-ink-3">{r.expected_revenue ? wonShort(r.expected_revenue) : "—"}</td>
                      <td className="px-2 py-2 text-right text-ink-3">{r.actual_qty ? num(r.actual_qty) : "—"}</td>
                      <td className="px-2 py-2 text-right text-ink-3">{r.actual_revenue ? won(r.actual_revenue) : "—"}</td>
                      <td className="px-2 py-2 text-center">
                        <SubscriptionCell
                          row={r}
                          busy={pending === `sub:${r.product_id}`}
                          onToggle={(next) => toggleSubscription(r.product_id, next)}
                        />
                      </td>
                    </tr>
                  ))}
                  {sortedRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-2 py-6 text-center text-ink-4">
                        {query ? "검색 결과가 없습니다." : "플랜·성과 모두 없습니다."}
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

// 정기구독 칼럼 — 상시/정기구독 라벨 + 수동 오버라이드.
// · 구독·자동(개월 감지): 읽기전용 배지  · 구독·수동(오버라이드): 해제 토글
// · 상시: 클릭하면 이 상품 전체를 구독으로 지정(오버라이드)
function SubscriptionCell({
  row,
  busy,
  onToggle,
}: {
  row: DiagnosticRow;
  busy: boolean;
  onToggle: (next: boolean) => void;
}) {
  if (row.is_subscription) {
    if (row.is_subscription_override) {
      return (
        <button
          onClick={() => onToggle(false)}
          disabled={busy}
          aria-pressed
          title="이 상품 전체가 정기구독으로 수동 지정됨 — 클릭하면 해제"
          className="rounded-full bg-subscription-soft px-2 py-0.5 text-[10px] font-medium text-subscription"
        >
          ✓ 정기구독 <span className="opacity-70">수동</span>
        </button>
      );
    }
    return (
      <span
        title="option_info 배송주기(개월)로 자동 감지 — 달성률에서 제외, 별도 집계"
        className="inline-block rounded-full bg-subscription-soft px-2 py-0.5 text-[10px] font-medium text-subscription"
      >
        정기구독 <span className="opacity-70">자동</span>
      </span>
    );
  }
  return (
    <button
      onClick={() => onToggle(true)}
      disabled={busy}
      aria-pressed={false}
      title="상시(단건) 판매 — 클릭하면 이 상품 전체를 정기구독으로 지정(오버라이드)"
      className="rounded-full bg-soft px-2 py-0.5 text-[10px] font-medium text-ink-4 hover:text-subscription"
    >
      상시
    </button>
  );
}

function SideBadge({ side, isMapped }: { side: DiagnosticRow["side"]; isMapped: boolean }) {
  if (side === "both" || isMapped) return <StatusBadge tone="success" label={isMapped ? "수동 연동" : "자동 매칭"} />;
  if (side === "plan") return <StatusBadge tone="warning" label="플랜만" />;
  return <StatusBadge tone="neutral" label="성과만" />;
}
