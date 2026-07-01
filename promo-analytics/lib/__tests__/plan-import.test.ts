import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildPlanWorkbook, type ExportOption } from "../plan-export";
import { parsePlanWorkbook } from "../plan-import";

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
  {
    label: "단품",
    is_main: false,
    expected_option_qty: 120,
    net_price: 12900,
    discount_rate_consumer: 0.3,
    expected_revenue: 1548000,
    expected_contribution: 400000,
    items: [{ base_name: "포캣트릿 닭가슴살 25g", sku_qty: 1, unit_price: 12900, cost: 4000, consumer_price: 18000 }],
  },
];

describe("parsePlanWorkbook (내보내기↔가져오기 왕복)", () => {
  const wb = buildPlanWorkbook(
    { campaign: "테스트", period: "2026-06-08 ~ 2026-06-14", version: "v1", purposes: ["세일즈"], channel: "공식몰" },
    options,
    { revenue: 25678000, order_count: 520, sku_units: 2120, contribution: 7831563, contribution_rate: 0.305 },
    null,
  );
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const buf = (out instanceof Uint8Array ? out.buffer : out) as ArrayBuffer;
  const { options: parsed } = parsePlanWorkbook(buf);

  it("옵션 수·라벨·메인·예상세트수 복원", () => {
    expect(parsed).toHaveLength(2);
    expect(parsed[0].option_label).toBe("모래 4묶음 세트");
    expect(parsed[0].is_main).toBe(true);
    expect(parsed[0].expected_option_qty).toBe(400);
    expect(parsed[1].is_main).toBe(false);
  });

  it("SKU 구성·세트당수량·단가·원가 복원 (세트 합계 ↔ 1개 단가 환산)", () => {
    expect(parsed[0].items).toHaveLength(2);
    // 내보내기는 세트 합계(단가×수량)로 쓰고, 가져오기는 세트당수량으로 나눠 1개 단가를 복원한다.
    expect(parsed[0].items[0]).toMatchObject({
      base_name: "퓨저나이트 슈퍼볼 4.3kg",
      sku_qty_per_option: 4,
      unit_sale_price: 10900,
      cost: 8000,
      consumer_price: 21800,
    });
    expect(parsed[0].items[1].base_name).toBe("바이바이배드 500ml");
    expect(parsed[1].items[0].base_name).toBe("포캣트릿 닭가슴살 25g");
    expect(parsed[1].items[0].unit_sale_price).toBe(12900);
  });

  it("플랜 시트 헤더가 없으면 빈 옵션", () => {
    const wb2 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([["관계없는", "시트"]]), "기타");
    const o2 = XLSX.write(wb2, { type: "array", bookType: "xlsx" });
    const b2 = (o2 instanceof Uint8Array ? o2.buffer : o2) as ArrayBuffer;
    expect(parsePlanWorkbook(b2).options).toEqual([]);
  });
});
