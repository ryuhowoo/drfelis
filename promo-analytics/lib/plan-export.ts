import * as XLSX from "xlsx";

// 플랜 Excel 내보내기 (로드맵 3.1). 순수 빌더(buildPlanWorkbook)는 테스트 대상,
// downloadPlanXlsx는 브라우저 다운로드 래퍼. 1차는 값 기반(어긋남 0) — 라이브 수식·
// SKU마스터 XLOOKUP·가져오기 왕복은 후속.

export type ExportItem = {
  base_name: string;
  sku_qty: number;
  unit_price: number;
  cost: number | null;
  consumer_price: number | null;
};
export type ExportOption = {
  label: string;
  is_main: boolean;
  expected_option_qty: number;
  net_price: number; // 쿠폰 적용 후 옵션 단가
  discount_rate_consumer: number | null;
  expected_revenue: number;
  expected_contribution: number;
  items: ExportItem[];
};
export type ExportSummary = {
  revenue: number;
  order_count: number; // 구매건수(세트)
  sku_units: number; // 판매수량(SKU)
  contribution: number;
  contribution_rate: number | null;
};
export type ExportCoupon = { min: number; ratePct: number; max: number } | null;

const PLAN_HEADER = [
  "옵션명",
  "메인",
  "예상세트수",
  "SKU",
  "세트당수량",
  "단가",
  "원가",
  "소비자가",
  "옵션단가",
  "할인율(%)",
  "예상매출",
  "예상공헌",
];

/** 플랜 데이터 → 워크북 (플랜·요약 시트). 값 기반이라 다시 올려도 어긋남이 없다. */
export function buildPlanWorkbook(
  title: string,
  options: ExportOption[],
  summary: ExportSummary,
  coupon: ExportCoupon,
): XLSX.WorkBook {
  // 플랜 시트 — 옵션×SKU 한 행. 옵션 레벨 값은 옵션 첫 행에만 채워 가독성↑(가져오기 시 직전 값 상속).
  const rows: (string | number)[][] = [PLAN_HEADER];
  for (const o of options) {
    const disc = o.discount_rate_consumer != null ? +(o.discount_rate_consumer * 100).toFixed(1) : "";
    o.items.forEach((it, i) => {
      rows.push([
        i === 0 ? o.label : "",
        i === 0 ? (o.is_main ? "Y" : "") : "",
        i === 0 ? o.expected_option_qty : "",
        it.base_name,
        it.sku_qty,
        it.unit_price,
        it.cost ?? "",
        it.consumer_price ?? "",
        i === 0 ? Math.round(o.net_price) : "",
        i === 0 ? disc : "",
        i === 0 ? Math.round(o.expected_revenue) : "",
        i === 0 ? Math.round(o.expected_contribution) : "",
      ]);
    });
    if (o.items.length === 0) {
      rows.push([o.label, o.is_main ? "Y" : "", o.expected_option_qty, "", "", "", "", "", Math.round(o.net_price), "", Math.round(o.expected_revenue), Math.round(o.expected_contribution)]);
    }
  }
  const planWs = XLSX.utils.aoa_to_sheet(rows);

  // 요약 시트
  const sum: (string | number)[][] = [
    ["항목", "값"],
    ["캠페인", title],
    ["예상 매출액", Math.round(summary.revenue)],
    ["구매건수(세트)", summary.order_count],
    ["판매수량(SKU)", summary.sku_units],
    ["예상 공헌이익액", Math.round(summary.contribution)],
    ["공헌이익률(%)", summary.contribution_rate != null ? +(summary.contribution_rate * 100).toFixed(1) : ""],
  ];
  if (coupon && coupon.ratePct > 0) {
    sum.push(["쿠폰 기준액(원 이상)", coupon.min]);
    sum.push(["쿠폰 할인율(%)", coupon.ratePct]);
    sum.push(["쿠폰 최대할인(원)", coupon.max]);
  }
  const sumWs = XLSX.utils.aoa_to_sheet(sum);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sumWs, "요약");
  XLSX.utils.book_append_sheet(wb, planWs, "플랜");
  return wb;
}

/** 브라우저에서 xlsx 다운로드 트리거 */
export function downloadPlanXlsx(
  filename: string,
  title: string,
  options: ExportOption[],
  summary: ExportSummary,
  coupon: ExportCoupon,
): void {
  const wb = buildPlanWorkbook(title, options, summary, coupon);
  XLSX.writeFile(wb, filename);
}
