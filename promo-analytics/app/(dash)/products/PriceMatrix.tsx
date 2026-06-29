"use client";

import { useState } from "react";
import { won, pctFloor } from "@/lib/format";
import {
  TIER_QTY,
  discountVsConsumer,
  marginRate,
  addonUnitPrice,
  contribution,
  contributionRate,
} from "@/lib/pricing";
import type { ProductRow, ConfigLite } from "./ProductsTable";

const SANGSI_BUNDLES = ["2묶음", "3묶음", "4묶음", "5묶음", "6묶음"];
const JEONGGI = ["단품", "2묶음", "4묶음"];

type BaseField = "consumer_price" | "cost" | "regular_price";

// 시트형 가격 매트릭스. 가격 셀(소비자가·원가·상시가 + 묶음/정기 판매가)은 인라인 편집,
// 할인율·마진율·추가구성·공헌이익은 자동 계산(읽기).
export default function PriceMatrix({
  rows,
  configsByProduct,
  mult,
  onOpen,
  onPatchBase,
  onSaveConfig,
}: {
  rows: ProductRow[];
  configsByProduct: Record<string, ConfigLite[]>;
  mult: number;
  onOpen: (r: ProductRow) => void;
  onPatchBase: (id: string, field: BaseField, value: string) => void;
  onSaveConfig: (id: string, mode: string, type: string, value: string) => void;
}) {
  const price = (pid: string, mode: string, type: string): number | null => {
    const c = (configsByProduct[pid] ?? []).find((x) => x.sale_mode === mode && x.config_type === type);
    return c?.sale_price ?? null;
  };

  const th = "border border-line/60 px-2 py-1 font-medium whitespace-nowrap";
  const td = "border border-line/50 px-1 py-0.5 text-right tabular-nums whitespace-nowrap";
  const tdL = "border border-line/50 px-2 py-1 text-left whitespace-nowrap";

  return (
    <div className="mt-3 overflow-x-auto rounded-2xl card-soft">
      <p className="px-3 pt-2 text-[11px] text-ink-4">파란 셀은 클릭해 바로 수정(가격만). 할인율·마진율·공헌이익은 자동 계산돼요.</p>
      <table className="min-w-[1680px] border-collapse text-[11px]">
        <thead>
          <tr className="bg-soft text-ink-3">
            <th className={th} colSpan={5}>기본</th>
            <th className={`${th} bg-neutral-50`} colSpan={4}>상시 단가</th>
            <th className={`${th} bg-green-50`} colSpan={SANGSI_BUNDLES.length}>묶음 (상시)</th>
            <th className={`${th} bg-purple-50`} colSpan={JEONGGI.length}>정기구독</th>
            <th className={`${th} bg-rose-50`} colSpan={2}>공헌(상시)</th>
            <th className={`${th} bg-rose-50`} colSpan={JEONGGI.length}>공헌(정기)</th>
          </tr>
          <tr className="bg-soft/70 text-ink-3">
            <th className={th}>품목코드</th>
            <th className={th}>브랜드</th>
            <th className={th}>카테고리</th>
            <th className={th}>상품명</th>
            <th className={th}></th>
            <th className={th}>소비자가</th>
            <th className={th}>원가</th>
            <th className={th}>상시가</th>
            <th className={th}>할인/마진/추가</th>
            {SANGSI_BUNDLES.map((t) => (
              <th key={t} className={`${th} bg-green-50/50`}>{t}</th>
            ))}
            {JEONGGI.map((t) => (
              <th key={t} className={`${th} bg-purple-50/50`}>{t}</th>
            ))}
            <th className={`${th} bg-rose-50/50`}>이익액</th>
            <th className={`${th} bg-rose-50/50`}>이익률</th>
            {JEONGGI.map((t) => (
              <th key={t} className={`${th} bg-rose-50/50`}>{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const consumer = r.consumer_price;
            const regular = r.regular_price;
            const cost = r.cost;
            return (
              <tr key={r.id} className="text-ink-2 hover:bg-soft/30">
                <td className={tdL}>{r.dr_code ?? "—"}</td>
                <td className={tdL}>{r.brand ?? "—"}</td>
                <td className={tdL}>{r.category ?? "—"}</td>
                <td className={`${tdL} max-w-[260px]`} title={r.base_name}>
                  <span className="block truncate">{r.base_name}</span>
                  {r.status !== "판매중" && <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700">{r.status}</span>}
                </td>
                <td className="border border-line/50 px-1 py-0.5 text-center">
                  <button onClick={() => onOpen(r)} className="rounded px-1 text-[10px] text-brand-600 hover:bg-brand-50" title="가격 구성·세트 편집">구성</button>
                </td>
                <td className={td}><EditNum value={consumer} onSave={(v) => onPatchBase(r.id, "consumer_price", v)} /></td>
                <td className={td}><EditNum value={cost} onSave={(v) => onPatchBase(r.id, "cost", v)} /></td>
                <td className={td}><EditNum value={regular} onSave={(v) => onPatchBase(r.id, "regular_price", v)} /></td>
                <td className={`${td} text-[10px] text-ink-4`}>
                  {pctFloor(discountVsConsumer(regular, consumer, 1))} / {pctFloor(marginRate(regular, cost))} / {won(addonUnitPrice(regular))}
                </td>
                {SANGSI_BUNDLES.map((t) => (
                  <td key={t} className={`${td} bg-green-50/30`}>
                    <EditNum value={price(r.id, "상시", t)} onSave={(v) => onSaveConfig(r.id, "상시", t, v)} />
                    <span className="block text-[10px] text-ink-4">{pctFloor(discountVsConsumer(price(r.id, "상시", t), consumer, TIER_QTY[t]))}</span>
                  </td>
                ))}
                {JEONGGI.map((t) => (
                  <td key={t} className={`${td} bg-purple-50/30`}>
                    <EditNum value={price(r.id, "정기", t)} onSave={(v) => onSaveConfig(r.id, "정기", t, v)} />
                    <span className="block text-[10px] text-ink-4">{pctFloor(discountVsConsumer(price(r.id, "정기", t), consumer, TIER_QTY[t]))}</span>
                  </td>
                ))}
                <td className={`${td} bg-rose-50/30`}>{won(contribution(regular, cost, 1, mult))}</td>
                <td className={`${td} bg-rose-50/30`}>{pctFloor(contributionRate(regular, cost, 1, mult))}</td>
                {JEONGGI.map((t) => {
                  const p = price(r.id, "정기", t);
                  return (
                    <td key={t} className={`${td} bg-rose-50/30`}>{p != null ? won(contribution(p, cost, TIER_QTY[t], mult)) : "—"}</td>
                  );
                })}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td className="px-3 py-8 text-center text-ink-4" colSpan={20}>상품이 없습니다.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// 인라인 숫자 셀 — 콤마 표시, 변경 시 blur 저장.
function EditNum({ value, onSave }: { value: number | null; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value != null ? value.toLocaleString("ko-KR") : "");
  return (
    <input
      value={shown}
      inputMode="numeric"
      placeholder="—"
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ""))}
      onBlur={() => {
        if (draft != null && Number(draft || "0") !== (value ?? 0)) onSave(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(null);
      }}
      className="w-20 rounded border border-transparent bg-blue-50/40 px-1 py-0.5 text-right tabular-nums hover:border-line focus:border-brand-400 focus:bg-card focus:outline-none"
    />
  );
}
