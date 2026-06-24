import * as XLSX from "xlsx";

// 플랜 Excel 가져오기 (로드맵 3.2). 내보내기(plan-export)와 같은 양식의 '플랜' 시트를 파싱해
// 옵션·SKU 구성을 복원한다. 순수 함수(parsePlanWorkbook)는 테스트 대상.
// 옵션 레벨 값(옵션명·메인·예상세트수)은 각 옵션 첫 행에만 있고, 이후 빈 옵션명 행은 직전 옵션의 SKU.

export type ParsedPlanItem = {
  base_name: string;
  sku_qty_per_option: number;
  unit_sale_price: number;
  cost: number | null;
};
export type ParsedPlanOption = {
  option_label: string;
  is_main: boolean;
  expected_option_qty: number;
  items: ParsedPlanItem[];
};

const HEADERS = {
  option: "옵션명",
  main: "메인",
  qty: "예상세트수",
  sku: "SKU",
  setQty: "세트당수량",
  unit: "단가",
  cost: "원가",
} as const;

function colIndex(header: (string | number)[], name: string): number {
  return header.findIndex((h) => String(h).trim() === name);
}
function num(v: unknown): number {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
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
    unit: colIndex(header, HEADERS.unit),
    cost: colIndex(header, HEADERS.cost),
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
      current.items.push({
        base_name: sku,
        sku_qty_per_option: ci.setQty >= 0 ? num(row[ci.setQty]) : 0,
        unit_sale_price: ci.unit >= 0 ? Math.round(num(row[ci.unit])) : 0,
        cost:
          ci.cost >= 0 && String(row[ci.cost] ?? "").trim() !== ""
            ? num(row[ci.cost])
            : null,
      });
    }
  }
  return { options: options.filter((o) => o.items.length > 0 || o.option_label) };
}
