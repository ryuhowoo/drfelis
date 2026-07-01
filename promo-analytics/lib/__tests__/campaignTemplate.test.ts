import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseCampaignMeta } from "../campaignTemplate";

// '캠페인' 시트 1행짜리 워크북을 만들어 buffer 로 반환
function makeWorkbook(startCell: unknown, endCell: unknown): ArrayBuffer {
  const header = [
    "캠페인명",
    "시작일",
    "종료일",
    "혜택유형",
    "시즌",
    "판매채널",
    "대표할인율(%)",
    "목적_세일즈",
    "목적_브랜딩",
    "목적_재고소진",
  ];
  const row = ["테스트 캠페인", startCell, endCell, "할인", "여름", "자사몰", 50, 8, "", ""];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, row], { cellDates: true });
  XLSX.utils.book_append_sheet(wb, ws, "캠페인");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return (out instanceof Uint8Array ? out.buffer : out) as ArrayBuffer;
}

describe("parseCampaignMeta 날짜 파싱 (타임존 하루 밀림 방지)", () => {
  // 실제 엑셀 파일은 날짜를 '시리얼 숫자'(타임존 독립)로 저장한다. 46160 = 2026-05-18.
  it("엑셀 날짜 시리얼을 하루 밀리지 않고 정확히 복원한다", () => {
    const meta = parseCampaignMeta(makeWorkbook(46160, 46161));
    expect(meta).not.toBeNull();
    expect(meta!.start_date).toBe("2026-05-18");
    expect(meta!.end_date).toBe("2026-05-19");
  });

  it("문자열 날짜도 그대로 복원한다", () => {
    const meta = parseCampaignMeta(makeWorkbook("2026-05-18", "2026-05-19"));
    expect(meta!.start_date).toBe("2026-05-18");
    expect(meta!.end_date).toBe("2026-05-19");
  });
});
