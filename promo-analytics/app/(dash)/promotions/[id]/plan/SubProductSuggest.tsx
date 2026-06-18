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
}: {
  existingProductIds: string[];
  onAdd: (b: Bench) => void;
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

  const list = (rows ?? []).filter((r) => !existing.has(r.product_id)).slice(0, 10);

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
          <div className="mt-2 flex items-center justify-between">
            <p className="text-xs text-ink-4">
              누르면 평균 단가·예상수량·원가가 채워진 서브 옵션이 추가됩니다. 가격·수량은 수정하세요.
            </p>
            <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-3">
              <input type="checkbox" checked={recent} onChange={(e) => setRecent(e.target.checked)} />
              최근 3개월만
            </label>
          </div>
          {rows == null ? (
            <p className="mt-3 text-xs text-ink-4">불러오는 중…</p>
          ) : list.length === 0 ? (
            <p className="mt-3 text-xs text-ink-4">추천할 서브 상품이 없습니다(이미 모두 추가됨).</p>
          ) : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
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
