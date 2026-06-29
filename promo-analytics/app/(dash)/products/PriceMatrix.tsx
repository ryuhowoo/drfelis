"use client";

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

// 시트형 가격 매트릭스(읽기). 가격만 보고, 행 클릭 시 가격 구성 편집 드로어 열림.
export default function PriceMatrix({
  rows,
  configsByProduct,
  mult,
  onOpen,
}: {
  rows: ProductRow[];
  configsByProduct: Record<string, ConfigLite[]>;
  mult: number;
  onOpen: (r: ProductRow) => void;
}) {
  const price = (pid: string, mode: string, type: string): number | null => {
    const c = (configsByProduct[pid] ?? []).find((x) => x.sale_mode === mode && x.config_type === type);
    return c?.sale_price ?? null;
  };

  const th = "border border-line/60 px-2 py-1 font-medium whitespace-nowrap";
  const td = "border border-line/50 px-2 py-1 text-right tabular-nums whitespace-nowrap";
  const tdL = "border border-line/50 px-2 py-1 text-left whitespace-nowrap";

  return (
    <div className="mt-3 overflow-x-auto rounded-2xl card-soft">
      <table className="min-w-[1600px] border-collapse text-[11px]">
        <thead>
          <tr className="bg-soft text-ink-3">
            <th className={th} colSpan={4}>기본</th>
            <th className={`${th} bg-neutral-50`} colSpan={6}>상시 단가</th>
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
            <th className={th}>소비자가</th>
            <th className={th}>원가</th>
            <th className={th}>상시가</th>
            <th className={th}>할인율</th>
            <th className={th}>마진율</th>
            <th className={th}>추가구성</th>
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
              <tr
                key={r.id}
                onClick={() => onOpen(r)}
                className="cursor-pointer text-ink-2 hover:bg-brand-50/40"
                title="클릭하면 가격 구성 편집"
              >
                <td className={tdL}>{r.dr_code ?? "—"}</td>
                <td className={tdL}>{r.brand ?? "—"}</td>
                <td className={tdL}>{r.category ?? "—"}</td>
                <td className={`${tdL} max-w-[280px]`} title={r.base_name}>
                  <span className="block truncate">{r.base_name}</span>
                  {r.status !== "판매중" && (
                    <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700">{r.status}</span>
                  )}
                </td>
                <td className={td}>{won(consumer)}</td>
                <td className={td}>{won(cost)}</td>
                <td className={td}>{won(regular)}</td>
                <td className={td}>{pctFloor(discountVsConsumer(regular, consumer, 1))}</td>
                <td className={td}>{pctFloor(marginRate(regular, cost))}</td>
                <td className={td}>{won(addonUnitPrice(regular))}</td>
                {SANGSI_BUNDLES.map((t) => {
                  const p = price(r.id, "상시", t);
                  return (
                    <td key={t} className={`${td} bg-green-50/30`}>
                      {p != null ? (
                        <>
                          {won(p)}
                          <span className="ml-1 text-[10px] text-ink-4">{pctFloor(discountVsConsumer(p, consumer, TIER_QTY[t]))}</span>
                        </>
                      ) : "—"}
                    </td>
                  );
                })}
                {JEONGGI.map((t) => {
                  const p = price(r.id, "정기", t);
                  return (
                    <td key={t} className={`${td} bg-purple-50/30`}>
                      {p != null ? (
                        <>
                          {won(p)}
                          <span className="ml-1 text-[10px] text-ink-4">{pctFloor(discountVsConsumer(p, consumer, TIER_QTY[t]))}</span>
                        </>
                      ) : "—"}
                    </td>
                  );
                })}
                <td className={`${td} bg-rose-50/30`}>{won(contribution(regular, cost, 1, mult))}</td>
                <td className={`${td} bg-rose-50/30`}>{pctFloor(contributionRate(regular, cost, 1, mult))}</td>
                {JEONGGI.map((t) => {
                  const p = price(r.id, "정기", t);
                  return (
                    <td key={t} className={`${td} bg-rose-50/30`}>
                      {p != null ? won(contribution(p, cost, TIER_QTY[t], mult)) : "—"}
                    </td>
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
