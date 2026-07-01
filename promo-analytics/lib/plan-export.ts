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

export type ExportMeta = {
  campaign: string; // 플랜(캠페인)명
  period: string; // "2026-06-08 ~ 2026-06-14"
  version: string; // "v2"
  purposes: string[]; // 목적
  channel?: string | null; // 판매 채널
};

// 금액 컬럼은 '세트(옵션) 기준 합계' — 세트당수량을 이미 곱한 값. 가져오기(plan-import)와 통일.
const PLAN_HEADER = [
  "옵션명",
  "메인",
  "예상세트수",
  "SKU",
  "세트당수량",
  "판매가(세트)",
  "원가(세트)",
  "소비자가(세트)",
  "옵션단가",
  "할인율(%)",
  "예상매출",
  "예상공헌",
];

/** 플랜 데이터 → 워크북 (플랜·요약 시트). 값 기반이라 다시 올려도 어긋남이 없다. */
export function buildPlanWorkbook(
  meta: ExportMeta,
  options: ExportOption[],
  summary: ExportSummary,
  coupon: ExportCoupon,
): XLSX.WorkBook {
  // 플랜 시트 — 옵션×SKU 한 행. 옵션 레벨 값은 옵션 첫 행에만 채워 가독성↑(가져오기 시 직전 값 상속).
  const rows: (string | number)[][] = [PLAN_HEADER];
  for (const o of options) {
    const disc = o.discount_rate_consumer != null ? +(o.discount_rate_consumer * 100).toFixed(1) : "";
    o.items.forEach((it, i) => {
      const q = it.sku_qty || 0;
      rows.push([
        i === 0 ? o.label : "",
        i === 0 ? (o.is_main ? "Y" : "") : "",
        i === 0 ? o.expected_option_qty : "",
        it.base_name,
        it.sku_qty,
        Math.round(it.unit_price * q), // 판매가(세트)
        it.cost != null ? Math.round(it.cost * q) : "", // 원가(세트)
        it.consumer_price != null ? Math.round(it.consumer_price * q) : "", // 소비자가(세트)
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

  // 요약 시트 — 캠페인·기간·목적 + 핵심 지표 + 추가할인쿠폰(없으면 '없음')
  const couponText =
    coupon && coupon.ratePct > 0
      ? `${coupon.min.toLocaleString("ko-KR")}원 이상 ${coupon.ratePct}% (최대 ${coupon.max.toLocaleString("ko-KR")}원)`
      : "없음";
  const sum: (string | number)[][] = [
    ["항목", "값"],
    ["캠페인", meta.campaign],
    ["기간", meta.period],
    ["플랜 버전", meta.version],
    ["판매 채널", meta.channel || "—"],
    ["목적", meta.purposes.length ? meta.purposes.join(", ") : "—"],
    ["예상 매출액", Math.round(summary.revenue)],
    ["구매건수(세트)", summary.order_count],
    ["판매수량(SKU)", summary.sku_units],
    ["예상 공헌이익액", Math.round(summary.contribution)],
    ["공헌이익률(%)", summary.contribution_rate != null ? +(summary.contribution_rate * 100).toFixed(1) : ""],
    ["추가할인쿠폰", couponText],
  ];
  const sumWs = XLSX.utils.aoa_to_sheet(sum);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sumWs, "요약");
  XLSX.utils.book_append_sheet(wb, planWs, "플랜");
  return wb;
}

/** 파일명 = '플랜명-기간.xlsx' (경로 불가 문자만 정리, 한글·괄호·대시는 유지) */
export function planFileName(meta: ExportMeta): string {
  const base = `${meta.campaign}-${meta.period.replace(/\s+/g, "")}`;
  const safe = base
    .replace(/[/\\:*?"<>|\n\r\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return `${safe || "플랜"}.xlsx`;
}

/** 브라우저에서 xlsx 다운로드 트리거 */
export function downloadPlanXlsx(
  meta: ExportMeta,
  options: ExportOption[],
  summary: ExportSummary,
  coupon: ExportCoupon,
): void {
  const wb = buildPlanWorkbook(meta, options, summary, coupon);
  XLSX.writeFile(wb, planFileName(meta));
}
