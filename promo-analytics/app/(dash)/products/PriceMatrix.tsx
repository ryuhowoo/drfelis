"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { won, pctFloor } from "@/lib/format";
import { useTableSort } from "@/lib/table-sort";
import {
  TIER_QTY,
  discountVsConsumer,
  marginRate,
  addonUnitPrice,
  contribution,
  contributionRate,
} from "@/lib/pricing";
import type { ProductRow, ConfigLite, Rates } from "./ProductsTable";

const SANGSI_BUNDLES = ["2묶음", "3묶음", "4묶음", "5묶음", "6묶음"];
const JEONGGI = ["단품", "2묶음", "4묶음"];

type BaseField = "consumer_price" | "cost" | "regular_price" | "base_name";

// 매트릭스 정렬용 파생값을 곁들인 행
type MatrixRow = ProductRow & {
  _discount: number | null; // 소비자가 대비 할인율(상시가 기준)
  _margin: number | null; // 마진율
  _addon: number | null; // 추가구성 단가
};

// 정렬 가능한 열 정의 (품목코드/카테고리/서브카테고리/상품명/소비자가/원가/상시가/할인·마진·추가)
type SortKey = keyof MatrixRow;

// 시트형 가격 매트릭스. 가격 셀(소비자가·원가·상시가 + 묶음/정기 판매가)·상품명은 인라인 편집,
// 할인율·마진율·추가구성·공헌이익은 자동 계산(읽기). 광고비/수수료/물류비는 매출액의 %로 직접 조정.
export default function PriceMatrix({
  rows,
  configsByProduct,
  rates,
  onOpen,
  onPatchBase,
  onSaveConfig,
}: {
  rows: ProductRow[];
  configsByProduct: Record<string, ConfigLite[]>;
  rates: Rates;
  onOpen: (r: ProductRow) => void;
  onPatchBase: (id: string, field: BaseField, value: string) => void;
  onSaveConfig: (id: string, mode: string, type: string, value: string) => void;
}) {
  // 광고비·수수료·물류비를 매출액의 %로 직접 조정 (소수점 아래 1자리). 적립금은 rate card 값 고정.
  const [feePct, setFeePct] = useState<number>(round1(rates.fee_rate * 100));
  const [adPct, setAdPct] = useState<number>(round1(rates.ad_rate * 100));
  const [logiPct, setLogiPct] = useState<number>(round1(rates.logistics_rate * 100));
  const rewardPct = round1(rates.reward_rate * 100);
  const mult = 1 - (feePct + adPct + logiPct + rewardPct) / 100;

  const price = (pid: string, mode: string, type: string): number | null => {
    const c = (configsByProduct[pid] ?? []).find((x) => x.sale_mode === mode && x.config_type === type);
    return c?.sale_price ?? null;
  };

  // 정렬용 파생값 부착
  const augmented: MatrixRow[] = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        _discount: discountVsConsumer(r.regular_price, r.consumer_price, 1),
        _margin: marginRate(r.regular_price, r.cost),
        _addon: addonUnitPrice(r.regular_price),
      })),
    [rows],
  );
  const { sorted, toggle, arrow } = useTableSort<MatrixRow>(augmented, null, "asc");

  const th = "border border-line/60 px-2 py-1 font-medium whitespace-nowrap";
  const td = "border border-line/50 px-1 py-0.5 text-right tabular-nums whitespace-nowrap";
  const tdL = "border border-line/50 px-2 py-1 text-left whitespace-nowrap";

  // 좌측 고정 열(품목코드·카테고리·서브카테고리·상품명·구성) — 횡스크롤 시 상품 식별 유지
  const stickyCols = [
    { key: "dr_code" as SortKey, label: "품목코드", left: 0, w: 76 },
    { key: "category" as SortKey, label: "카테고리", left: 76, w: 92 },
    { key: "brand" as SortKey, label: "서브 카테고리", left: 168, w: 108 },
    { key: "base_name" as SortKey, label: "상품명", left: 276, w: 224 },
    { key: null, label: "", left: 500, w: 44 }, // 구성 버튼
  ];
  const stickyW = 544;
  // 헤더 그룹행(상단) 높이 ≈ 1.9rem → 2번째 헤더행 top 오프셋
  const ROW1 = "1.9rem";

  function sortableTh(key: SortKey, label: string, left: number, w: number) {
    return (
      <th
        key={label}
        onClick={() => toggle(key)}
        style={{ left, minWidth: w, maxWidth: w, top: ROW1 }}
        className={`${th} sticky z-40 cursor-pointer select-none bg-soft/95 hover:bg-soft`}
        title="클릭하여 정렬"
      >
        {label}
        {arrow(key)}
      </th>
    );
  }

  function downloadXlsx() {
    const header = [
      "품목코드",
      "카테고리",
      "서브 카테고리",
      "상품명",
      "소비자가",
      "원가",
      "상시가",
      "할인율(소비자)",
      "마진율",
      "추가구성",
      ...SANGSI_BUNDLES.map((t) => `상시 ${t}`),
      ...JEONGGI.map((t) => `정기 ${t}`),
      "공헌이익(상시)",
      "공헌이익률(상시)",
      ...JEONGGI.map((t) => `공헌(정기 ${t})`),
    ];
    const body = sorted.map((r) => [
      r.dr_code ?? "",
      r.category ?? "",
      r.brand ?? "",
      r.base_name,
      r.consumer_price ?? "",
      r.cost ?? "",
      r.regular_price ?? "",
      pctFloor(r._discount),
      pctFloor(r._margin),
      r._addon ?? "",
      ...SANGSI_BUNDLES.map((t) => price(r.id, "상시", t) ?? ""),
      ...JEONGGI.map((t) => price(r.id, "정기", t) ?? ""),
      contribution(r.regular_price, r.cost, 1, mult) ?? "",
      pctFloor(contributionRate(r.regular_price, r.cost, 1, mult)),
      ...JEONGGI.map((t) => {
        const p = price(r.id, "정기", t);
        return p != null ? contribution(p, r.cost, TIER_QTY[t], mult) ?? "" : "";
      }),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "가격 가이드");
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `가격가이드_${today}.xlsx`);
  }

  return (
    <div className="mt-3 space-y-3">
      {/* 변동비(매출액 %) 조정 + 엑셀 다운로드 */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl card-soft p-3">
        <RateInput label="광고비" value={adPct} onChange={setAdPct} />
        <RateInput label="수수료" value={feePct} onChange={setFeePct} />
        <RateInput label="물류비" value={logiPct} onChange={setLogiPct} />
        <div className="flex flex-col">
          <span className="text-[11px] text-ink-4">적립금(고정)</span>
          <span className="px-1 py-1.5 text-sm tabular-nums text-ink-3">{rewardPct.toFixed(1)}%</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] text-ink-4">공헌이익 승수(mult)</span>
          <span className="px-1 py-1.5 text-sm font-semibold tabular-nums text-ink">{mult.toFixed(3)}</span>
        </div>
        <button
          onClick={downloadXlsx}
          className="ml-auto rounded-xl border border-line bg-card px-4 py-2 text-sm font-medium text-ink-2 hover:bg-brand-50"
          title="현재 가격표를 엑셀로 내려받기"
        >
          ⬇ 엑셀 다운로드
        </button>
      </div>

      <div className="relative max-h-[75vh] overflow-auto rounded-2xl card-soft">
        <p className="px-3 pt-2 text-[11px] text-ink-4">
          파란 셀·상품명은 클릭해 바로 수정. 광고비/수수료/물류비는 매출액의 %이며, 할인율·마진율·공헌이익은 자동 계산돼요.
          헤더를 클릭하면 오름/내림차순 정렬됩니다.
        </p>
        <table className="min-w-[1720px] border-collapse text-[11px]">
          <thead>
            <tr className="bg-soft text-ink-3">
              <th
                className={`${th} sticky left-0 top-0 z-50 bg-soft`}
                colSpan={5}
                style={{ minWidth: stickyW, maxWidth: stickyW }}
              >
                기본
              </th>
              <th className={`${th} sticky top-0 z-30 bg-neutral-50`} colSpan={4}>상시 단가</th>
              <th className={`${th} sticky top-0 z-30 bg-green-50`} colSpan={SANGSI_BUNDLES.length}>묶음 (상시)</th>
              <th className={`${th} sticky top-0 z-30 bg-purple-50`} colSpan={JEONGGI.length}>정기구독</th>
              <th className={`${th} sticky top-0 z-30 bg-rose-50`} colSpan={2}>공헌(상시)</th>
              <th className={`${th} sticky top-0 z-30 bg-rose-50`} colSpan={JEONGGI.length}>공헌(정기)</th>
            </tr>
            <tr className="bg-soft/70 text-ink-3">
              {sortableTh(stickyCols[0].key!, stickyCols[0].label, stickyCols[0].left, stickyCols[0].w)}
              {sortableTh(stickyCols[1].key!, stickyCols[1].label, stickyCols[1].left, stickyCols[1].w)}
              {sortableTh(stickyCols[2].key!, stickyCols[2].label, stickyCols[2].left, stickyCols[2].w)}
              {sortableTh(stickyCols[3].key!, stickyCols[3].label, stickyCols[3].left, stickyCols[3].w)}
              <th
                style={{ left: stickyCols[4].left, minWidth: stickyCols[4].w, maxWidth: stickyCols[4].w, top: ROW1 }}
                className={`${th} sticky z-40 bg-soft/95`}
              ></th>
              <SortTh onClick={() => toggle("consumer_price")} className={th} top={ROW1}>소비자가{arrow("consumer_price")}</SortTh>
              <SortTh onClick={() => toggle("cost")} className={th} top={ROW1}>원가{arrow("cost")}</SortTh>
              <SortTh onClick={() => toggle("regular_price")} className={th} top={ROW1}>상시가{arrow("regular_price")}</SortTh>
              <SortTh onClick={() => toggle("_discount")} className={th} top={ROW1}>할인/마진/추가{arrow("_discount")}</SortTh>
              {SANGSI_BUNDLES.map((t) => (
                <th key={t} style={{ top: ROW1 }} className={`${th} sticky z-30 bg-green-50/50`}>{t}</th>
              ))}
              {JEONGGI.map((t) => (
                <th key={t} style={{ top: ROW1 }} className={`${th} sticky z-30 bg-purple-50/50`}>{t}</th>
              ))}
              <th style={{ top: ROW1 }} className={`${th} sticky z-30 bg-rose-50/50`}>이익액</th>
              <th style={{ top: ROW1 }} className={`${th} sticky z-30 bg-rose-50/50`}>이익률</th>
              {JEONGGI.map((t) => (
                <th key={t} style={{ top: ROW1 }} className={`${th} sticky z-30 bg-rose-50/50`}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const consumer = r.consumer_price;
              const regular = r.regular_price;
              const cost = r.cost;
              return (
                <tr key={r.id} className="text-ink-2 hover:bg-soft/30">
                  <td className={`${tdL} sticky z-20 bg-card`} style={{ left: stickyCols[0].left, minWidth: stickyCols[0].w, maxWidth: stickyCols[0].w }}>{r.dr_code ?? "—"}</td>
                  <td className={`${tdL} sticky z-20 bg-card`} style={{ left: stickyCols[1].left, minWidth: stickyCols[1].w, maxWidth: stickyCols[1].w }}>{r.category ?? "—"}</td>
                  <td className={`${tdL} sticky z-20 bg-card`} style={{ left: stickyCols[2].left, minWidth: stickyCols[2].w, maxWidth: stickyCols[2].w }}>{r.brand ?? "—"}</td>
                  <td
                    className={`${tdL} sticky z-20 bg-card`}
                    style={{ left: stickyCols[3].left, minWidth: stickyCols[3].w, maxWidth: stickyCols[3].w }}
                  >
                    <EditText value={r.base_name} onSave={(v) => onPatchBase(r.id, "base_name", v)} />
                    {r.status !== "판매중" && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">{r.status}</span>}
                  </td>
                  <td className="sticky z-20 border border-line/50 bg-card px-1 py-0.5 text-center" style={{ left: stickyCols[4].left, minWidth: stickyCols[4].w, maxWidth: stickyCols[4].w }}>
                    <button onClick={() => onOpen(r)} className="rounded px-1 text-[10px] text-brand-600 hover:bg-brand-50" title="가격 구성·세트 편집">구성</button>
                  </td>
                  <td className={td}><EditNum value={consumer} onSave={(v) => onPatchBase(r.id, "consumer_price", v)} /></td>
                  <td className={td}><EditNum value={cost} onSave={(v) => onPatchBase(r.id, "cost", v)} /></td>
                  <td className={td}><EditNum value={regular} onSave={(v) => onPatchBase(r.id, "regular_price", v)} /></td>
                  <td className={`${td} text-[10px] text-ink-4`}>
                    {pctFloor(r._discount)} / {pctFloor(r._margin)} / {won(r._addon)}
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
            {sorted.length === 0 && (
              <tr>
                <td className="px-3 py-8 text-center text-ink-4" colSpan={20}>상품이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// 정렬 가능한 일반 헤더 셀 (좌측 고정 아님) — 상단 2행 고정을 위해 sticky top.
function SortTh({
  onClick,
  className,
  top,
  children,
}: {
  onClick: () => void;
  className: string;
  top: string;
  children: React.ReactNode;
}) {
  return (
    <th
      onClick={onClick}
      style={{ top }}
      className={`${className} sticky z-30 cursor-pointer select-none bg-soft/95 hover:bg-soft`}
      title="클릭하여 정렬"
    >
      {children}
    </th>
  );
}

// 매출액 % 입력 — 소수점 아래 1자리까지.
function RateInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value.toFixed(1);
  return (
    <label className="flex flex-col">
      <span className="text-[11px] text-ink-4">{label} (매출 %)</span>
      <div className="flex items-center gap-1">
        <input
          inputMode="decimal"
          value={shown}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ""))}
          onBlur={() => {
            if (draft != null) {
              const n = round1(Number(draft) || 0);
              onChange(n);
              setDraft(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="w-16 rounded-lg border border-line bg-card px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-brand-400"
        />
        <span className="text-xs text-ink-4">%</span>
      </div>
    </label>
  );
}

// 인라인 텍스트 셀 (상품명) — 변경 시 blur 저장.
function EditText({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  return (
    <input
      value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft != null && draft !== value) onSave(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(null);
      }}
      title={value}
      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-left text-[11px] hover:border-line focus:border-brand-400 focus:bg-card focus:outline-none"
    />
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
