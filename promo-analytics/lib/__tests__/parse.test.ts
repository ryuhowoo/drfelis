import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parsePromotionSheet, parseSegmentSheet } from "../parse";

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

// 세그먼트(회원/비회원 × 회원등급 × 카테고리 × 일반/정기) 분해 export — 실제 카페24 헤더
const SEG_HEADER = [
  "일자 (누적)",
  "판매 채널",
  "기초 상품명",
  "상품명",
  "옵션정보",
  "회원/비회원 주문",
  "일반/정기 배송",
  "기초 상품 카테고리",
  "주문 회원등급",
  "결제금액 (환불/취소 제외)",
  "결제금액 (환불/취소 제외) %",
  "결제 건수 (클레임 제외)",
  "평균 주문 가치 (AOV) (환불/취소 제외)",
  "수수료 (발생 환불/취소 제외)",
  "원가 (환불/취소 제외)",
  "기초 상품 판매 수량 (환불/취소 제외)",
  "상품 판매가 할인 (환불/취소 제외)",
  "객단가(ARPPU) (환불/취소 제외)",
  "결제 유저수 (환불/취소 제외)",
];

describe("parseSegmentSheet — 세그먼트 분해 export", () => {
  const buf = sheetBuf([
    SEG_HEADER,
    [
      "2026-06-08 ~ 2026-06-14 ", "카페24", "퓨저나이트 슈퍼볼 8.3kg (대용량)", "퓨저나이트 슈퍼볼 8.3kg",
      "상품선택=슈퍼볼 8.3kg 4개", "회원", "일반", "배변용품", "고영희",
      "61490", "1", "1", "61490", "2367", "34400", "4", "0", "61490", "1",
    ],
    [
      "2026-06-08 ~ 2026-06-14 ", "카페24", "어떤 간식", "어떤 간식",
      "옵션X", "비회원", "정기", "간식", "-",
      "12000", "1", "2", "6000", "400", "5000", "3", "0", "6000", "2",
    ],
    [
      "2026-06-08 ~ 2026-06-14 ", "카페24", "직원 구매품", "직원 구매품",
      "옵션Y", "회원", "일반", "용품", "Staff",
      "9000", "1", "1", "9000", "0", "8000", "1", "0", "9000", "1",
    ],
  ]);
  const parsed = parseSegmentSheet(buf);

  it("회원/비회원·회원등급·카테고리를 분리해 읽는다", () => {
    expect(parsed.rows[0].member_type).toBe("회원");
    expect(parsed.rows[0].member_grade).toBe("고영희");
    expect(parsed.rows[0].category).toBe("배변용품");
  });

  it("'-' 등급·비회원을 null/비회원으로 정규화한다", () => {
    expect(parsed.rows[1].member_type).toBe("비회원");
    expect(parsed.rows[1].member_grade).toBeNull();
  });

  it("일반/정기를 order_type으로, ARPPU·결제유저수를 읽는다", () => {
    expect(parsed.rows[0].order_type).toBe("onetime");
    expect(parsed.rows[1].order_type).toBe("subscription");
    expect(parsed.rows[0].arppu).toBe(61490);
    expect(parsed.rows[1].paying_users).toBe(2);
  });

  it("AOV·수량·매출을 읽고 Staff 행도 보존한다(집계 단계에서 제외)", () => {
    expect(parsed.rows[0].aov).toBe(61490);
    expect(parsed.rows[0].quantity).toBe(4);
    expect(parsed.rows[2].member_grade).toBe("Staff");
    expect(parsed.rows).toHaveLength(3);
  });

  it("누적 기간을 파싱한다", () => {
    expect(parsed.start_date).toBe("2026-06-08");
    expect(parsed.end_date).toBe("2026-06-14");
  });
});
