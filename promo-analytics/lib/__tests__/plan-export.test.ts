import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildPlanWorkbook, planFileName, type ExportOption, type ExportSummary } from "../plan-export";

const meta = {
  campaign: "[BETTER HABITS] 활력을 키우는 습관 — 가격 가이드(플랜)",
  period: "2026-06-08 ~ 2026-06-14",
  version: "v2",
  purposes: ["세일즈", "브랜딩"],
};

const options: ExportOption[] = [
  {
    label: "모래 4묶음 세트",
    is_main: true,
    expected_option_qty: 400,
    net_price: 63500,
    discount_rate_consumer: 0.458,
    expected_revenue: 24130000,
    expected_contribution: 7431563,
    items: [
      { base_name: "퓨저나이트 슈퍼볼 4.3kg", sku_qty: 4, unit_price: 10900, cost: 8000, consumer_price: 21800 },
      { base_name: "바이바이배드 500ml", sku_qty: 1, unit_price: 19900, cost: 9000, consumer_price: 30000 },
    ],
  },
];
const summary: ExportSummary = {
  revenue: 24130000,
  order_count: 400,
  sku_units: 2000,
  contribution: 7431563,
  contribution_rate: 0.308,
};

describe("buildPlanWorkbook", () => {
  const wb = buildPlanWorkbook(meta, options, summary, { min: 50000, ratePct: 5, max: 5000 });
  // 워크북을 바이너리로 쓰고 다시 읽어 셀을 검증(왕복)
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const buf = (out instanceof Uint8Array ? out.buffer : out) as ArrayBuffer;
  const rb = XLSX.read(buf, { type: "array" });

  it("요약·플랜 시트가 있다", () => {
    expect(rb.SheetNames).toContain("요약");
    expect(rb.SheetNames).toContain("플랜");
  });

  it("플랜 시트: 옵션 첫 행에 옵션단가·예상매출, SKU 행에 단가/원가", () => {
    const aoa = XLSX.utils.sheet_to_json(rb.Sheets["플랜"], { header: 1 }) as (string | number)[][];
    expect(aoa[0]).toContain("옵션단가");
    // 첫 데이터 행(옵션 첫 SKU) — 옵션명·옵션단가·예상매출 채워짐
    const r1 = aoa[1];
    expect(r1[0]).toBe("모래 4묶음 세트");
    expect(r1[3]).toBe("퓨저나이트 슈퍼볼 4.3kg");
    expect(r1[8]).toBe(63500); // 옵션단가
    expect(r1[10]).toBe(24130000); // 예상매출
    // 둘째 SKU 행 — 옵션 레벨은 비고 SKU 값만
    const r2 = aoa[2];
    expect(r2[0]).toBe("");
    expect(r2[3]).toBe("바이바이배드 500ml");
    expect(r2[5]).toBe(19900); // 단가
  });

  it("요약 시트: 캠페인·기간·목적·지표·쿠폰 모두 포함", () => {
    const aoa = XLSX.utils.sheet_to_json(rb.Sheets["요약"], { header: 1 }) as (string | number)[][];
    const map = new Map(aoa.map((r) => [r[0], r[1]]));
    expect(map.get("캠페인")).toBe(meta.campaign);
    expect(map.get("기간")).toBe("2026-06-08 ~ 2026-06-14");
    expect(map.get("목적")).toBe("세일즈, 브랜딩");
    expect(map.get("구매건수(세트)")).toBe(400);
    expect(map.get("판매수량(SKU)")).toBe(2000);
    expect(map.get("공헌이익률(%)")).toBe(30.8);
    expect(map.get("추가할인쿠폰")).toContain("5%");
  });

  it("쿠폰 없으면 '없음'", () => {
    const wb2 = buildPlanWorkbook(meta, options, summary, null);
    const aoa = XLSX.utils.sheet_to_json(wb2.Sheets["요약"], { header: 1 }) as (string | number)[][];
    const map = new Map(aoa.map((r) => [r[0], r[1]]));
    expect(map.get("추가할인쿠폰")).toBe("없음");
  });

  it("파일명 = 플랜명-기간.xlsx (경로문자 정리)", () => {
    expect(planFileName(meta)).toBe(
      "[BETTER HABITS] 활력을 키우는 습관 — 가격 가이드(플랜)-2026-06-08~2026-06-14.xlsx",
    );
    expect(planFileName({ ...meta, campaign: "여름/세일" })).toBe(
      "여름 세일-2026-06-08~2026-06-14.xlsx",
    );
  });
});
