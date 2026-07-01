import * as XLSX from "xlsx";

// 플랜 Excel 가져오기 (로드맵 3.2). 내보내기(plan-export)와 같은 양식의 '플랜' 시트를 파싱해
// 옵션·SKU 구성을 복원한다. 순수 함수(parsePlanWorkbook)는 테스트 대상.
// 옵션 레벨 값(옵션명·메인·예상세트수)은 각 옵션 첫 행에만 있고, 이후 빈 옵션명 행은 직전 옵션의 SKU.
//
// ★ 금액 컬럼은 '세트(옵션) 기준 합계'다 — 세트당수량을 이미 곱한 값(예: 4.3kg 8개입 세트 판매가 59,200원).
//   내부 단가(unit_sale_price)·원가·소비자가는 세트당수량으로 나눠 SKU 1개 기준으로 환산한다.
//   (과거엔 '단가'를 1개 기준으로 봤는데, 사용자가 세트 판매가를 넣으면 세트당수량만큼 부풀어
//    옵션 단가가 폭증하고 할인율이 음수가 되는 문제가 있었다. 세트 합계 기준으로 통일해 해결.)

export type ParsedPlanItem = {
  base_name: string;
  sku_qty_per_option: number;
  unit_sale_price: number; // SKU 1개 기준 판매가 (= 세트 판매가 / 세트당수량)
  cost: number | null; // SKU 1개 기준 원가
  consumer_price: number | null; // SKU 1개 기준 소비자가
  regular_price: number | null; // SKU 1개 기준 상시가
};
export type ParsedPlanOption = {
  option_label: string;
  is_main: boolean;
  expected_option_qty: number;
  items: ParsedPlanItem[];
};

// 헤더 후보 — 신 양식(세트 합계)과 구 양식('단가') 모두 인식.
const HEADERS = {
  option: ["옵션명"],
  main: ["메인"],
  qty: ["예상세트수"],
  sku: ["SKU"],
  setQty: ["세트당수량"],
  sale: ["판매가(세트)", "판매가", "옵션판매가", "단가"],
  cost: ["원가(세트)", "원가"],
  consumer: ["소비자가(세트)", "소비자가"],
  regular: ["상시가(세트)", "상시가"],
} as const;

function colIndex(header: (string | number)[], names: readonly string[]): number {
  const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, "").trim();
  return header.findIndex((h) => names.some((n) => norm(h) === norm(n)));
}
function num(v: unknown): number {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(v: unknown): number | null {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** 플랜 시트 → 옵션 목록. '플랜' 시트가 없으면 첫 시트를 시도. */
export function parsePlanWorkbook(buf: ArrayBuffer): { options: ParsedPlanOption[] } {
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames.includes("플랜") ? "플랜" : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) return { options: [] };
  const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, blankrows: false });
  if (aoa.length < 2) return { options: [] };

  const header = aoa[0];
  const ci = {
    option: colIndex(header, HEADERS.option),
    main: colIndex(header, HEADERS.main),
    qty: colIndex(header, HEADERS.qty),
    sku: colIndex(header, HEADERS.sku),
    setQty: colIndex(header, HEADERS.setQty),
    sale: colIndex(header, HEADERS.sale),
    cost: colIndex(header, HEADERS.cost),
    consumer: colIndex(header, HEADERS.consumer),
    regular: colIndex(header, HEADERS.regular),
  };
  if (ci.option < 0 || ci.sku < 0) return { options: [] };

  const options: ParsedPlanOption[] = [];
  let current: ParsedPlanOption | null = null;
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r];
    const label = String(row[ci.option] ?? "").trim();
    const sku = String(row[ci.sku] ?? "").trim();
    if (label) {
      current = {
        option_label: label,
        is_main: String(row[ci.main] ?? "").trim().toUpperCase() === "Y",
        expected_option_qty: ci.qty >= 0 ? Math.round(num(row[ci.qty])) : 0,
        items: [],
      };
      options.push(current);
    }
    if (sku && current) {
      // 세트당수량으로 나눠 SKU 1개 기준으로 환산 (금액은 세트 합계 입력)
      const q = ci.setQty >= 0 ? num(row[ci.setQty]) : 0;
      const div = q > 0 ? q : 1;
      const saleTotal = ci.sale >= 0 ? numOrNull(row[ci.sale]) : null;
      const costTotal = ci.cost >= 0 ? numOrNull(row[ci.cost]) : null;
      const consumerTotal = ci.consumer >= 0 ? numOrNull(row[ci.consumer]) : null;
      const regularTotal = ci.regular >= 0 ? numOrNull(row[ci.regular]) : null;
      current.items.push({
        base_name: sku,
        sku_qty_per_option: q,
        unit_sale_price: saleTotal != null ? saleTotal / div : 0,
        cost: costTotal != null ? costTotal / div : null,
        consumer_price: consumerTotal != null ? consumerTotal / div : null,
        regular_price: regularTotal != null ? regularTotal / div : null,
      });
    }
  }
  return { options: options.filter((o) => o.items.length > 0 || o.option_label) };
}
