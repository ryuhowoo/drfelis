import * as XLSX from "xlsx";

// ─────────────────────────────────────────────
// 공통 유틸
// ─────────────────────────────────────────────
function norm(s: unknown): string {
  return String(s ?? "")
    .replace(/\s+/g, "")
    .replace(/[()[\]/+_.%]/g, "")
    .toLowerCase();
}

/** 헤더 행에서 후보 키워드 중 하나라도 포함하는 첫 컬럼 인덱스 */
function findCol(header: unknown[], candidates: string[]): number {
  const normed = header.map(norm);
  for (let i = 0; i < normed.length; i++) {
    if (candidates.some((c) => normed[i].includes(norm(c)))) return i;
  }
  return -1;
}

function toNum(v: unknown): number {
  if (v == null || v === "" || v === "-") return 0;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/[, ₩%]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function toDateStr(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return ymd(v);
  const s = String(v).trim();
  const m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : ymd(d);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function pad(n: number | string): string {
  return String(n).padStart(2, "0");
}

/** 워크북의 첫 시트를 2차원 배열로 */
function firstSheetRows(buf: ArrayBuffer): unknown[][] {
  const wb = XLSX.read(buf, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
}

/** 헤더 행 탐색: 후보 키워드가 가장 많이 매칭되는 행 (상위 15행 내) */
function findHeaderRow(rows: unknown[][], keys: string[]): number {
  let best = -1,
    bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const normed = rows[i].map(norm);
    const score = keys.filter((k) =>
      normed.some((c) => c.includes(norm(k))),
    ).length;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= 2 ? best : -1;
}

// ─────────────────────────────────────────────
// ① 일별 매출 추이
// ─────────────────────────────────────────────
export type DailyRow = {
  sale_date: string;
  base_name: string;
  option_info: string;
  revenue: number;
  quantity: number;
};

export function parseDailySales(buf: ArrayBuffer): DailyRow[] {
  const rows = firstSheetRows(buf);
  const h = findHeaderRow(rows, ["일자", "기초상품명", "결제금액", "판매수량"]);
  if (h < 0) throw new Error("일별 매출 추이 헤더를 찾을 수 없습니다 (일자/기초상품명/결제금액/판매수량).");
  const header = rows[h];
  const cDate = findCol(header, ["일자"]);
  const cName = findCol(header, ["기초상품명", "상품명"]);
  const cOpt = findCol(header, ["옵션정보", "옵션"]);
  const cRev = findCol(header, ["결제금액"]);
  const cQty = findCol(header, ["판매수량", "수량"]);

  const out: DailyRow[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    const date = toDateStr(r[cDate]);
    const name = String(r[cName] ?? "").trim();
    if (!date || !name || name === "-") continue;
    out.push({
      sale_date: date,
      base_name: name,
      option_info: String(r[cOpt] ?? "").trim(),
      revenue: toNum(r[cRev]),
      quantity: toNum(r[cQty]),
    });
  }
  return out;
}

// ─────────────────────────────────────────────
// ② 프로모션 시트 (기간 실적, 전 제품)
// ─────────────────────────────────────────────
export type PromoSalesRow = {
  base_name: string;
  option_info: string;
  revenue: number;
  order_count: number;
  aov: number;
  fee: number;
  cost: number;
  quantity: number;
};

export type ParsedPromotion = {
  start_date: string | null;
  end_date: string | null;
  rows: PromoSalesRow[];
};

export function parsePromotionSheet(buf: ArrayBuffer): ParsedPromotion {
  const rows = firstSheetRows(buf);
  const h = findHeaderRow(rows, ["일자", "기초상품명", "결제금액", "원가", "수수료"]);
  if (h < 0) throw new Error("프로모션 시트 헤더를 찾을 수 없습니다.");
  const header = rows[h];
  const cPeriod = findCol(header, ["일자"]);
  const cName = findCol(header, ["기초상품명", "상품명"]);
  const cOpt = findCol(header, ["옵션정보", "옵션"]);
  const cRev = findCol(header, ["결제금액"]);
  const cCnt = findCol(header, ["결제건수", "건수"]);
  const cAov = findCol(header, ["평균주문가치", "aov"]);
  const cFee = findCol(header, ["수수료"]);
  const cCost = findCol(header, ["원가"]);
  const cQty = findCol(header, ["판매수량", "수량"]);

  let start: string | null = null;
  let end: string | null = null;
  const out: PromoSalesRow[] = [];

  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[cName] ?? "").trim();
    if (!name || name === "-") continue;

    // 기간: "2025-12-08 ~ 2025-12-14" 형태에서 한 번만 추출
    if (!start && cPeriod >= 0) {
      const p = String(r[cPeriod] ?? "");
      const parts = p.split("~");
      if (parts.length >= 2) {
        start = toDateStr(parts[0]);
        end = toDateStr(parts[1]);
      } else {
        start = toDateStr(p);
      }
    }

    out.push({
      base_name: name,
      option_info: String(r[cOpt] ?? "").trim(),
      revenue: toNum(r[cRev]),
      order_count: toNum(r[cCnt]),
      aov: toNum(r[cAov]),
      fee: toNum(r[cFee]),
      cost: toNum(r[cCost]),
      quantity: toNum(r[cQty]),
    });
  }
  return { start_date: start, end_date: end, rows: out };
}

// ─────────────────────────────────────────────
// ③ 마스터 (품목코드)
// ─────────────────────────────────────────────
export type MasterRow = {
  base_name: string;
  dr_code: string | null;
  cost: number | null;
  consumer_price: number | null;
  regular_price: number | null;
};

export function parseMaster(buf: ArrayBuffer): MasterRow[] {
  const rows = firstSheetRows(buf);
  const h = findHeaderRow(rows, ["품목코드", "품목명", "원가", "소비자가", "상시가"]);
  if (h < 0) throw new Error("마스터(품목코드) 헤더를 찾을 수 없습니다.");
  const header = rows[h];
  const cCode = findCol(header, ["품목코드", "코드"]);
  const cName = findCol(header, ["품목명", "상품명"]);
  // 원가는 'VAT+' 우선
  const cCostVat = findCol(header, ["제품원가vat+", "원가vat+"]);
  const cCost = cCostVat >= 0 ? cCostVat : findCol(header, ["원가"]);
  const cConsumer = findCol(header, ["소비자가"]);
  const cRegular = findCol(header, ["상시가"]);

  const out: MasterRow[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[cName] ?? "").trim();
    if (!name) continue;
    out.push({
      base_name: name,
      dr_code: cCode >= 0 ? String(r[cCode] ?? "").trim() || null : null,
      cost: cCost >= 0 ? toNum(r[cCost]) || null : null,
      consumer_price: cConsumer >= 0 ? toNum(r[cConsumer]) || null : null,
      regular_price: cRegular >= 0 ? toNum(r[cRegular]) || null : null,
    });
  }
  return out;
}

/** 프로모션명에서 코드 추출: CF_P_251208_모래반짝특가 → CF_P_251208 */
export function extractPromoCode(name: string): string | null {
  const m = name.match(/CF_P_\d{4,6}/i);
  return m ? m[0] : null;
}
