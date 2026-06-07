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

/** 워크북 객체 (여러 시트를 이름으로 지정해 파싱할 때 한 번만 읽어 재사용) */
export function readWorkbook(buf: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(buf, { cellDates: true });
}

/** 워크북의 시트 이름 목록 */
export function sheetNames(buf: ArrayBuffer): string[] {
  return readWorkbook(buf).SheetNames;
}

/** 지정 시트를 2차원 배열로 */
function sheetRows(wb: XLSX.WorkBook, sheetName: string): unknown[][] {
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`시트를 찾을 수 없습니다: ${sheetName}`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
}

/** 헤더 셀을 공백 제거·소문자만 적용해 반환 (VAT+/VAT− 구분처럼 부호를 보존해야 할 때) */
function rawHeader(header: unknown[]): string[] {
  return header.map((h) => String(h ?? "").replace(/\s+/g, "").toLowerCase());
}

/** 원시 헤더(부호 보존) 기준으로 조건에 맞는 첫 컬럼 인덱스 */
function findColRaw(header: unknown[], test: (raw: string) => boolean): number {
  return rawHeader(header).findIndex(test);
}

/** 주어진 키워드를 '모두' 포함하는 첫 헤더 행 (병합/주석 밴드가 섞인 시트용) */
function findHeaderRowAll(rows: unknown[][], keys: string[], maxScan = 20): number {
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const normed = rows[i].map(norm);
    if (keys.every((k) => normed.some((c) => c.includes(norm(k))))) return i;
  }
  return -1;
}

/** 행에 데이터가 한 칸이라도 있는지 (빈 행을 skip 카운트에서 제외) */
function rowHasData(r: unknown[]): boolean {
  return r.some((c) => String(c ?? "").trim() !== "");
}

function skipToArr(m: Map<string, number>): { reason: string; count: number }[] {
  return [...m.entries()].map(([reason, count]) => ({ reason, count }));
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

// ─────────────────────────────────────────────
// ④ 가격 마스터 (S1) — 품목 시트 + 가격가이드 시트
// ─────────────────────────────────────────────

export type Skip = { reason: string; count: number };

/** 품목 시트 → products upsert 페이로드 */
export type ItemMasterRow = {
  base_name: string;
  dr_code: string | null;
  cost: number | null; // 제품원가 (VAT+)
  cost_vat_excluded: number | null; // 제품원가 (VAT−)
  consumer_price: number | null;
  regular_price: number | null;
};

export type ItemMasterResult = {
  rows: ItemMasterRow[];
  skipped: Skip[];
};

/**
 * 품목 시트 파싱.
 * 매핑: 품목코드→dr_code, 품목명→base_name, 제품원가(VAT+)→cost,
 *       제품원가(VAT−)→cost_vat_excluded, 소비자가(VAT+)→consumer_price, 상시가(VAT+)→regular_price
 */
export function parseItemMaster(
  wb: XLSX.WorkBook,
  sheetName: string,
): ItemMasterResult {
  const rows = sheetRows(wb, sheetName);
  const h = findHeaderRow(rows, ["품목코드", "품목명", "원가", "소비자가", "상시가"]);
  if (h < 0)
    throw new Error(
      "품목 시트 헤더를 찾을 수 없습니다 (품목코드/품목명/원가/소비자가/상시가).",
    );
  const header = rows[h];
  const cCode = findCol(header, ["품목코드", "코드"]);
  const cName = findCol(header, ["품목명", "상품명"]);
  // 원가는 VAT+/VAT− 둘 다 norm 시 같은 문자열이 되므로 부호를 보존한 원시 매칭 사용
  const cCostPlus = findColRaw(header, (s) => s.includes("원가") && /vat[+＋]/.test(s));
  const cCostMinus = findColRaw(
    header,
    (s) => s.includes("원가") && /vat[-−－]/.test(s),
  );
  const cCostAny = findCol(header, ["원가"]);
  const cCost = cCostPlus >= 0 ? cCostPlus : cCostAny;
  const cConsumer = findCol(header, ["소비자가"]);
  const cRegular = findCol(header, ["상시가"]);

  const out: ItemMasterRow[] = [];
  const skip = new Map<string, number>();
  const bump = (r: string) => skip.set(r, (skip.get(r) ?? 0) + 1);

  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[cName] ?? "").trim();
    if (!name || name === "-") {
      if (rowHasData(r)) bump("품목명 없음");
      continue;
    }
    out.push({
      base_name: name,
      dr_code: cCode >= 0 ? String(r[cCode] ?? "").trim() || null : null,
      cost: cCost >= 0 ? toNum(r[cCost]) || null : null,
      cost_vat_excluded: cCostMinus >= 0 ? toNum(r[cCostMinus]) || null : null,
      consumer_price: cConsumer >= 0 ? toNum(r[cConsumer]) || null : null,
      regular_price: cRegular >= 0 ? toNum(r[cRegular]) || null : null,
    });
  }
  return { rows: out, skipped: skipToArr(skip) };
}

/** 가격가이드 시트 → product_price_configs 페이로드 + 카테고리 수집 */
export type ParsedPriceConfig = {
  dr_code: string | null;
  base_name: string | null;
  category: string | null;
  config_type: "단품" | "2묶음" | "3묶음" | "4묶음" | "5묶음";
  pack_count: number;
  free_shipping: boolean;
  list_price: number | null;
  sale_price: number;
  discount_rate_consumer: number | null;
  discount_rate_regular: number | null;
  unit_cost_total: number | null;
  contribution: number | null;
  contribution_rate: number | null;
};

export type PriceGuideResult = {
  configs: ParsedPriceConfig[];
  categories: { dr_code: string | null; base_name: string | null; category: string }[];
  skipped: Skip[];
};

/** 공식몰 기본 혜택: 5만원 이상 결제 시 배송비 무료 (구성 판매가가 이 값 이상이면 free_shipping) */
export const FREE_SHIP_THRESHOLD = 50000;

/** 가격/원가/소비자가/상시가 fallback (시트값 우선, 없으면 품목 시트 lookup) */
function pick(sheetVal: number, lookupVal: number | null | undefined): number | null {
  if (sheetVal && sheetVal > 0) return sheetVal;
  return lookupVal ?? null;
}

/** N묶음 '가격' 컬럼 탐지 — 할인율·공헌이익·수량 컬럼을 배제하고 가격 컬럼만 선택 */
function findPackPriceCol(header: unknown[], token: string): number {
  const raw = rawHeader(header);
  const t = token.toLowerCase();
  const excluded = (s: string) => /할인|율|공헌|마진|이익|수량|개수|원가/.test(s);
  // 1) 토큰 + 가격성 단어
  let idx = raw.findIndex(
    (s) => s.includes(t) && /(가격|판매가|세트가|금액|단가)/.test(s) && !excluded(s),
  );
  if (idx >= 0) return idx;
  // 2) 토큰 + 비배제
  idx = raw.findIndex((s) => s.includes(t) && !excluded(s));
  if (idx >= 0) return idx;
  // 3) 토큰 매칭 아무거나
  return raw.findIndex((s) => s.includes(t));
}

/**
 * 가격가이드 시트 파싱.
 * - 헤더행 = '품목코드'와 '소비자가'를 모두 포함하는 행으로 자동 탐지, 데이터는 그 다음 행부터
 * - 단품/2·3·4·5묶음 구성 생성. 가격 셀이 비면 그 구성은 skip
 * - 할인율·공헌이익은 시트값을 읽지 않고 계산식으로 산출 (mult = rate card 승수)
 * - 시트에 원가/소비자가/상시가가 없으면 품목 시트 lookup으로 보완
 */
export function parsePriceGuide(
  wb: XLSX.WorkBook,
  sheetName: string,
  opts: {
    mult: number;
    lookup?: Map<
      string,
      { cost: number | null; consumer_price: number | null; regular_price: number | null }
    >;
    freeShipThreshold?: number;
  },
): PriceGuideResult {
  const freeShipAt = opts.freeShipThreshold ?? FREE_SHIP_THRESHOLD;
  const rows = sheetRows(wb, sheetName);
  const h = findHeaderRowAll(rows, ["품목코드", "소비자가"]);
  if (h < 0)
    throw new Error(
      "가격가이드 시트 헤더를 찾을 수 없습니다 ('품목코드'와 '소비자가'가 같은 행에 있어야 합니다).",
    );
  const header = rows[h];
  const cCode = findCol(header, ["품목코드", "코드"]);
  const cName = findCol(header, ["품목명", "상품명"]);
  const cCat = findCol(header, ["카테고리", "분류"]);
  const cConsumer = findCol(header, ["소비자가"]);
  const cRegular = findCol(header, ["상시가"]);
  const cCostPlus = findColRaw(header, (s) => s.includes("원가") && /vat[+＋]/.test(s));
  const cCostAny = findCol(header, ["원가"]);
  const cCost = cCostPlus >= 0 ? cCostPlus : cCostAny;
  const packCols: Record<number, number> = {
    2: findPackPriceCol(header, "2묶음"),
    3: findPackPriceCol(header, "3묶음"),
    4: findPackPriceCol(header, "4묶음"),
    5: findPackPriceCol(header, "5묶음"),
  };

  const configs: ParsedPriceConfig[] = [];
  const categories: PriceGuideResult["categories"] = [];
  const skip = new Map<string, number>();
  const bump = (r: string) => skip.set(r, (skip.get(r) ?? 0) + 1);

  const make = (
    config_type: ParsedPriceConfig["config_type"],
    pack: number,
    sale: number,
    cp: number | null,
    rp: number | null,
    cost: number | null,
    name: string | null,
    dr: string | null,
    cat: string | null,
  ): ParsedPriceConfig => {
    const list = cp && cp > 0 ? cp * pack : null;
    const drc = list && list > 0 ? (list - sale) / list : null;
    const drr = rp && rp > 0 ? (rp * pack - sale) / (rp * pack) : null;
    const uct = cost && cost > 0 ? cost * pack : null;
    const contribution = uct != null ? sale * opts.mult - uct : null;
    const crate = contribution != null && sale > 0 ? contribution / sale : null;
    return {
      dr_code: dr,
      base_name: name,
      category: cat,
      config_type,
      pack_count: pack,
      // 공식몰 기본 혜택: 판매가 5만원 이상이면 자동 무료배송
      free_shipping: sale >= freeShipAt,
      list_price: list,
      sale_price: sale,
      discount_rate_consumer: drc,
      discount_rate_regular: drr,
      unit_cost_total: uct,
      contribution,
      contribution_rate: crate,
    };
  };

  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    const dr = cCode >= 0 ? String(r[cCode] ?? "").trim() || null : null;
    const name = cName >= 0 ? String(r[cName] ?? "").trim() || null : null;
    if (!dr && !name) {
      if (rowHasData(r)) bump("품목코드·품목명 모두 없음");
      continue;
    }
    const cat = cCat >= 0 ? String(r[cCat] ?? "").trim() || null : null;
    const look = dr && opts.lookup ? opts.lookup.get(dr) : undefined;
    const cp = pick(cConsumer >= 0 ? toNum(r[cConsumer]) : 0, look?.consumer_price);
    const rp = pick(cRegular >= 0 ? toNum(r[cRegular]) : 0, look?.regular_price);
    const cost = pick(cCost >= 0 ? toNum(r[cCost]) : 0, look?.cost);

    if (cat && (dr || name)) categories.push({ dr_code: dr, base_name: name, category: cat });

    // 단품: 판매가 = 상시가
    if (rp && rp > 0) configs.push(make("단품", 1, rp, cp, rp, cost, name, dr, cat));
    else bump("단품: 상시가 없음");

    // N묶음: 묶음 가격 컬럼 값이 있을 때만
    for (const n of [2, 3, 4, 5] as const) {
      const col = packCols[n];
      if (col < 0) continue;
      const price = toNum(r[col]);
      if (!price || price <= 0) continue; // 값 없으면 정상 skip (카운트하지 않음)
      configs.push(
        make(`${n}묶음`, n, price, cp, rp, cost, name, dr, cat),
      );
    }
  }
  return { configs, categories, skipped: skipToArr(skip) };
}
