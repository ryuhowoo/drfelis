"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { won, pct, num } from "@/lib/format";

// Phase 4 + Feature A — 서브상품 자동 예측. 메인 카테고리가 선택되면 '같은 카테고리가 메인이던 과거
// 캠페인'의 어태치율(메인 1개당 서브 평균수량)을 끌어와, 계획한 메인 수량에 맞춰 서브 수량을 제안.
// 카테고리 매칭 결과가 없으면 전역 빈도 벤치마크(0048)로 폴백해 패널이 비지 않게 한다.
export type Bench = {
  product_id: string;
  base_name: string;
  category: string | null;
  campaigns: number;
  avg_qty: number;
  avg_unit_price: number;
  consumer_price: number | null;
  regular_price: number | null;
  cost: number | null;
  avg_discount: number | null;
  total_revenue?: number | null; // 풀 내 누적 매출(서브 기여 규모)
  avg_attach_ratio?: number | null; // 메인 1개당 서브 평균수량 (category_sub_benchmarks)
};

export default function SubProductSuggest({
  existingProductIds,
  mainCategory,
  mainQty,
  onAdd,
  onAddAll,
}: {
  existingProductIds: string[];
  mainCategory?: string | null;
  mainQty?: number;
  onAdd: (b: Bench) => void;
  onAddAll?: (bs: Bench[]) => void;
}) {
  const [rows, setRows] = useState<Bench[] | null>(null);
  const [recent, setRecent] = useState(false);
  const [open, setOpen] = useState(false);
  const [fellBack, setFellBack] = useState(false);
  const existing = useMemo(() => new Set(existingProductIds), [existingProductIds]);
  const planMainQty = mainQty ?? 0;

  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createClient();
      setRows(null);
      // 1차: 카테고리 어태치율 벤치마크 (메인 카테고리가 메인이던 과거 캠페인 기준)
      const { data: catData } = await supabase.rpc("category_sub_benchmarks", {
        p_main_category: mainCategory ?? null,
        p_months: recent ? 3 : 12,
        p_exclude_skeys: null,
      });
      let list = (catData as Bench[]) ?? [];
      let usedFallback = false;
      // 폴백: 매칭되는 과거 캠페인이 없으면 전역 빈도 벤치마크로 대체(어태치율 없음)
      if (list.length === 0) {
        const { data } = await supabase.rpc("sub_product_benchmarks", {
          p_months: recent ? 3 : null,
          p_category: null,
          p_exclude_skeys: null,
        });
        list = (data as Bench[]) ?? [];
        usedFallback = list.length > 0;
      }
      if (alive) {
        setRows(list);
        setFellBack(usedFallback);
      }
    })();
    return () => {
      alive = false;
    };
  }, [recent, mainCategory]);

  // 메인/기존에 없는 모든 추천 상품
  const list = (rows ?? []).filter((r) => !existing.has(r.product_id));
  const catLabel = !mainCategory || mainCategory === "전체" ? "전체" : mainCategory;

  // 어태치율 → 계획 메인 수량 기준 권장 서브 수량
  const planned = (b: Bench): number | null =>
    b.avg_attach_ratio != null && planMainQty > 0 ? Math.round(b.avg_attach_ratio * planMainQty) : null;

  return (
    <div className="mt-4 rounded-2xl card-soft p-5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between">
        <span className="text-sm font-semibold text-ink-2">
          서브 상품 추천{" "}
          <span className="font-normal text-ink-4">
            · {fellBack ? "과거 캠페인 자주 판매(전역)" : `‘${catLabel === "배변용품" ? "배변용품(모래)" : catLabel}’ 메인 캠페인 함께 담은 비율`}
          </span>
        </span>
        <span className="text-ink-4">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-ink-4">
              {fellBack
                ? "해당 메인 카테고리의 과거 캠페인이 없어 전역 평균으로 대체했습니다. 누르면 상시가·예상수량이 채워집니다."
                : planMainQty > 0
                  ? `누르면 계획 메인 수량(${num(planMainQty)}개) × 함께 담은 비율로 환산된 서브 수량이 채워집니다(할인은 직접 조정).`
                  : "메인 옵션 수량을 입력하면 함께 담은 비율로 서브 수량이 자동 환산됩니다. 누르면 추천 서브가 추가됩니다."}
            </p>
            <div className="flex items-center gap-3">
              <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-3">
                <input type="checkbox" checked={recent} onChange={(e) => setRecent(e.target.checked)} />
                최근 3개월만
              </label>
              {onAddAll && list.length > 0 && (
                <button
                  type="button"
                  onClick={() => onAddAll(list)}
                  className="shrink-0 rounded-lg bg-brand-500 px-3 py-1 text-xs font-semibold text-white transition hover:bg-brand-600"
                >
                  서브 옵션 전체 추가 ({list.length})
                </button>
              )}
            </div>
          </div>
          {rows == null ? (
            <p className="mt-3 text-xs text-ink-4">불러오는 중…</p>
          ) : list.length === 0 ? (
            <p className="mt-3 text-xs text-ink-4">추천할 서브 상품이 없습니다(이미 모두 추가됨).</p>
          ) : (
            <ul className="mt-3 grid max-h-96 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {list.map((r) => {
                const rec = planned(r);
                return (
                  <li key={r.product_id}>
                    <button
                      type="button"
                      onClick={() => onAdd(r)}
                      className="flex w-full items-start justify-between gap-2 rounded-xl border border-line bg-card p-3 text-left transition hover:border-brand-300 hover:bg-brand-50/50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">{r.base_name}</span>
                        {/* 평균수량 · 매출 · 부착률 — 사용자 선택 지표 */}
                        <span className="mt-0.5 block text-[11px] text-ink-3">
                          평균 {Math.round(r.avg_qty)}개
                          {r.total_revenue != null ? ` · 매출 ${won(r.total_revenue)}` : ""}
                          {r.avg_attach_ratio != null
                            ? ` · 함께 담은 비율 메인 100개당 ${Math.round(r.avg_attach_ratio * 100)}개${rec != null ? ` (계획 ≈ ${num(rec)}개)` : ""}`
                            : ""}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-ink-4">
                          {r.campaigns}회 등장 · 단가 {won(r.avg_unit_price)}
                          {r.avg_discount != null ? ` · 할인 ${pct(r.avg_discount)}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] font-semibold text-brand-600">+ 추가</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
