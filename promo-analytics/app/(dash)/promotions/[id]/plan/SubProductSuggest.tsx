"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { won, pct } from "@/lib/format";

// Phase 4 — 서브상품 자동 예측. 과거 캠페인 벤치마크(자주/최근 판매)로 옵션단가·예상수량·
// 원가를 prefilled한 서브 옵션을 한 번에 추가 → 노가다 제거.
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
};

export default function SubProductSuggest({
  existingProductIds,
  onAdd,
  onAddAll,
}: {
  existingProductIds: string[];
  onAdd: (b: Bench) => void;
  onAddAll?: (bs: Bench[]) => void;
}) {
  const [rows, setRows] = useState<Bench[] | null>(null);
  const [recent, setRecent] = useState(false);
  const [open, setOpen] = useState(false);
  const existing = useMemo(() => new Set(existingProductIds), [existingProductIds]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc("sub_product_benchmarks", {
        p_months: recent ? 3 : null,
        p_category: null,
        p_exclude_skeys: null,
      });
      if (alive) setRows((data as Bench[]) ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [recent]);

  // 메인/기존에 없는 모든 추천 상품 (전체 표시 — 리스트는 스크롤)
  const list = (rows ?? []).filter((r) => !existing.has(r.product_id));

  return (
    <div className="mt-4 rounded-2xl card-soft p-5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between">
        <span className="text-sm font-semibold text-ink-2">
          서브 상품 추천 <span className="font-normal text-ink-4">· 과거 캠페인 자주 판매</span>
        </span>
        <span className="text-ink-4">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-ink-4">
              누르면 상시 판매가·예상수량·원가가 채워진 서브 옵션이 추가됩니다(할인은 직접 조정).
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
              {list.map((r) => (
                <li key={r.product_id}>
                  <button
                    type="button"
                    onClick={() => onAdd(r)}
                    className="flex w-full items-start justify-between gap-2 rounded-xl border border-line bg-card p-3 text-left transition hover:border-brand-300 hover:bg-brand-50/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{r.base_name}</span>
                      <span className="mt-0.5 block text-[11px] text-ink-4">
                        {r.campaigns}회 등장 · 평균 {Math.round(r.avg_qty)}개 · 단가 {won(r.avg_unit_price)}
                        {r.avg_discount != null ? ` · 할인 ${pct(r.avg_discount)}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] font-semibold text-brand-600">+ 추가</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
