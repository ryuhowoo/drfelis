import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parsePromotionSheet } from "../parse";

/** AOA → xlsx ArrayBuffer (parsePromotionSheet 입력 형태) */
function sheetBuf(aoa: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "채널별 매출");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return (out instanceof Uint8Array ? out.buffer : out) as ArrayBuffer;
}

// 닥터펠리스 '채널별 매출' 리치 export 헤더 (상품명 + 일반/정기 배송 + 기초 상품명 동시 존재)
const HEADER = [
  "일자 (누적)",
  "상품명",
  "일반/정기 배송",
  "옵션정보",
  "기초 상품명",
  "결제금액 (환불/취소 제외)",
  "결제 건수 (클레임 제외)",
  "수수료 (환불/취소 제외)",
  "원가 (환불/취소 제외)",
];

describe("parsePromotionSheet — 리치 채널별 매출 export", () => {
  const buf = sheetBuf([
    HEADER,
    [
      "2026-01-01 ~ 2026-06-17",
      "[정기구독] 모래 4.3kg/8.3kg", // 마케팅 상품명 (SKU 없음)
      "정기",
      "상품선택=마스터, 중량/수량=8.3kg/2개",
      "펠리스샌드 마스터 8.3kg (대용량)", // 기초상품명 (정규화명)
      "88029979",
      "1817",
      "3388871",
      "33832888",
    ],
    [
      "2026-01-01 ~ 2026-06-17",
      "퓨저나이트 슈퍼볼 8.3kg",
      "일반",
      "상품선택=🔥BEST DEAL🔥[56%⬇️] 퓨저나이트 슈퍼볼 8.3kg 4개",
      "퓨저나이트 슈퍼볼 8.3kg (대용량)",
      "57055970",
      "707",
      "2187327",
      "27485600",
    ],
  ]);
  const parsed = parsePromotionSheet(buf);

  it("기초상품명을 base_name으로 사용한다 (마케팅 상품명이 아님)", () => {
    expect(parsed.rows[0].base_name).toBe("펠리스샌드 마스터 8.3kg (대용량)");
    expect(parsed.rows[0].base_name).not.toContain("정기구독");
  });

  it("'일반/정기 배송' 컬럼을 order_type으로 인식한다", () => {
    expect(parsed.rows[0].order_type).toBe("subscription");
    expect(parsed.rows[1].order_type).toBe("onetime");
  });

  it("누적 기간(시작~종료)을 파싱한다", () => {
    expect(parsed.start_date).toBe("2026-01-01");
    expect(parsed.end_date).toBe("2026-06-17");
  });

  it("금액·원가를 읽는다", () => {
    expect(parsed.rows[0].revenue).toBe(88029979);
    expect(parsed.rows[1].cost).toBe(27485600);
  });
});
