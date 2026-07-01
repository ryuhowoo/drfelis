import * as XLSX from "xlsx";

// '새 캠페인 만들기' 엑셀 양식 — 한 워크북에 두 시트.
//  · '캠페인' 시트: 새 캠페인 폼의 모든 입력값(이름·기간·혜택유형·시즌·채널·할인율·목적 가중치).
//  · '플랜'   시트: 플랜 옵션(옵션명·메인·예상세트수·SKU·세트당수량·단가·원가) — plan-import 양식과 동일.
// 업로드하면 폼이 자동으로 채워지고, 플랜 옵션은 draft 플랜에 적재되어 '확정' 직전 상태가 됩니다.

export type CampaignMeta = {
  name: string;
  start_date: string | null;
  end_date: string | null;
  promo_types: string[];
  season_tags: string[];
  channel: string | null;
  discount_pct: number | null;
  weights: Record<string, number>; // 세일즈/브랜딩/재고소진 → 1~10
};

const META_HEADER = [
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
] as const;

// 금액은 모두 '세트(옵션) 기준 합계' — 세트당수량을 곱한 값(예: 8개입 세트 판매가 59,200원).
const PLAN_HEADER = [
  "옵션명",
  "메인",
  "예상세트수",
  "SKU",
  "세트당수량",
  "판매가(세트)",
  "원가(세트)",
  "소비자가(세트)",
  "상시가(세트)",
] as const;

function splitMulti(v: unknown): string[] {
  return String(v ?? "")
    .split(/[,;·、/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function ymd(v: unknown): string | null {
  if (v == null || v === "") return null;
  const p = (n: number) => String(n).padStart(2, "0");
  // 엑셀 날짜 시리얼(숫자) — 타임존과 무관하게 순수 산술로 달력 날짜 복원.
  // (cellDates 로 만든 Date 는 KST 등에서 미세 드리프트로 하루 앞당겨지는 문제가 있어 시리얼을 우선 사용)
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d && d.y) return `${d.y}-${p(d.m)}-${p(d.d)}`;
  }
  if (v instanceof Date) {
    // cellDates 결과가 Date 로 온 경우: 12시간 보정 후 UTC 기준으로 달력 날짜를 읽어
    // 타임존 오프셋·시리얼 드리프트에 의한 하루 밀림을 방지.
    const adj = new Date(v.getTime() + 12 * 60 * 60 * 1000);
    return `${adj.getUTCFullYear()}-${p(adj.getUTCMonth() + 1)}-${p(adj.getUTCDate())}`;
  }
  const s = String(v).replace(/\s+/g, "");
  const m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const d = new Date(String(v).trim());
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 한글이 안 깨지도록 xlsx/CSV 분기 디코드 */
function readBook(buf: ArrayBuffer): XLSX.WorkBook {
  const bytes = new Uint8Array(buf);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  // cellDates:false → 날짜 셀을 엑셀 시리얼(숫자) 그대로 받아 ymd()에서 타임존 무관하게 변환.
  if (isZip) return XLSX.read(buf, { cellDates: false });
  let text = new TextDecoder("utf-8").decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return XLSX.read(text, { type: "string", cellDates: false });
}

/** '캠페인' 시트 → 폼 자동 채움값. 시트가 없으면 첫 시트의 헤더+1행을 시도. */
export function parseCampaignMeta(buf: ArrayBuffer): CampaignMeta | null {
  const wb = readBook(buf);
  const name = wb.SheetNames.includes("캠페인") ? "캠페인" : wb.SheetNames[0];
  const ws = wb.Sheets[name];
  if (!ws) return null;
  const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(ws, {
    header: 1,
    blankrows: false,
    defval: "",
  });
  if (aoa.length < 2) return null;
  const header = aoa[0].map((h) => String(h).replace(/\s+/g, ""));
  const col = (label: string) =>
    header.findIndex((h) => h === label.replace(/\s+/g, ""));
  const row = aoa[1];
  const at = (label: string) => {
    const i = col(label);
    return i >= 0 ? row[i] : "";
  };
  const nameVal = String(at("캠페인명") ?? "").trim();
  if (!nameVal) return null;
  const weights: Record<string, number> = {};
  for (const [key, label] of [
    ["세일즈", "목적_세일즈"],
    ["브랜딩", "목적_브랜딩"],
    ["재고소진", "목적_재고소진"],
  ] as const) {
    const w = numOrNull(at(label));
    if (w != null && w > 0) weights[key] = Math.max(1, Math.min(10, Math.round(w)));
  }
  return {
    name: nameVal,
    start_date: ymd(at("시작일")),
    end_date: ymd(at("종료일")),
    promo_types: splitMulti(at("혜택유형")),
    season_tags: splitMulti(at("시즌")),
    channel: String(at("판매채널") ?? "").trim() || null,
    discount_pct: numOrNull(at("대표할인율(%)")),
    weights,
  };
}

/** 새 캠페인 엑셀 양식 워크북을 만들어 브라우저 다운로드 (예시 행 포함). */
export function downloadCampaignTemplate(filename = "새캠페인_플랜_양식.xlsx"): void {
  const wb = XLSX.utils.book_new();

  const metaRows = [
    META_HEADER as unknown as string[],
    [
      "모래 벌크업 세일",
      "2026-07-01",
      "2026-07-07",
      "할인,쿠폰",
      "여름",
      "자사몰",
      30,
      8,
      3,
      5,
    ],
    ["", "", "", "← 혜택유형·시즌은 쉼표로 복수 입력", "", "", "", "← 목적 가중치 1~10(빈칸=미선택)", "", ""],
  ];
  const wsMeta = XLSX.utils.aoa_to_sheet(metaRows);
  wsMeta["!cols"] = META_HEADER.map(() => ({ wch: 16 }));
  XLSX.utils.book_append_sheet(wb, wsMeta, "캠페인");

  const planRows = [
    PLAN_HEADER as unknown as string[],
    ["[4+4] 원티드 4.3kg 8개입", "Y", 160, "(제품) 펠리스샌드 원티드 4.3kg", 8, 59200, 27491, 118400, 79200],
    ["[1+1+1] 바이바이배드 500ml 3개입", "Y", 100, "(제품) 바이바이배드 500ml", 3, 30000, 19950, 90000, 59700],
    ["", "", "", "← 금액은 모두 '세트 전체' 합계(세트당수량 곱한 값). 소비자가/원가/상시가는 비워두면 상품 마스터 값으로 채웁니다.", "", "", "", "", ""],
    ["", "", "", "← 한 옵션에 SKU가 여러 개면 옵션명·메인·예상세트수는 첫 행에만", "", "", "", "", ""],
  ];
  const wsPlan = XLSX.utils.aoa_to_sheet(planRows);
  wsPlan["!cols"] = PLAN_HEADER.map(() => ({ wch: 18 }));
  XLSX.utils.book_append_sheet(wb, wsPlan, "플랜");

  XLSX.writeFile(wb, filename);
}
