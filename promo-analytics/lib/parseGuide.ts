import * as XLSX from "xlsx";

// 자사몰 '프로모션 가이드' 워크북 파서 (전용 임포터).
// 여러 시트에 캠페인 블록(CF_P 코드 + 상품표)이 박스로 쌓여 있고, 연도/캠페인마다 표 양식이 다르다.
// - 모든 시트를 스캔한다(블록이 시트별로 흩어져 있음).
// - 코드는 셀 시작이 'CF_P_' + 4~8자리(제목에 붙은 'CF_P_240301_제목'도 인식).
// - 실적(실판매량/판매수량/판매량 · 실매출/매출)만 읽고, 계획(목표)·구성(번들/재고)·
//   상시(월/평균 판매량)는 제외한다.

export type GuideProduct = { name: string; quantity: number; revenue: number };

export type GuideCampaign = {
  code: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  qty_label: string;
  rev_label: string;
  products: GuideProduct[];
  total_qty: number;
  total_revenue: number;
};

function norm(s: unknown): string {
  return String(s ?? "").replace(/\s+/g, "").toLowerCase();
}
function toNum(v: unknown): number {
  if (v == null || v === "" || v === "-") return 0;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/[,\s₩%]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function pad2(n: number | string): string {
  return String(n).padStart(2, "0");
}

// CF_P_ 뒤 숫자에서 코드/연도/날짜 도출. 8자리=YYYYMMDD, 6자리=YYMMDD, 4자리=YYMM(일 미상)
function codeFromCell(cell: string): { code: string; digits: string } | null {
  const m = cell.match(/^CF_P_(\d{4,8})/i);
  if (!m) return null;
  return { code: `CF_P_${m[1]}`, digits: m[1] };
}
function yearFromDigits(d: string): number | null {
  if (d.length === 8) return Number(d.slice(0, 4));
  if (d.length >= 2) return 2000 + Number(d.slice(0, 2));
  return null;
}
function dateFromDigits(d: string): string | null {
  let y: number, mm: number, dd: number;
  if (d.length === 8) {
    y = Number(d.slice(0, 4)); mm = Number(d.slice(4, 6)); dd = Number(d.slice(6, 8));
  } else if (d.length === 6) {
    y = 2000 + Number(d.slice(0, 2)); mm = Number(d.slice(2, 4)); dd = Number(d.slice(4, 6));
  } else return null; // 4자리는 일 미상 → 기간에서 보완
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${y}-${pad2(mm)}-${pad2(dd)}`;
}

function parsePeriod(text: string, fallbackYear: number | null) {
  const re =
    /(?:(\d{4})[.\-/])?(\d{1,2})[.\-/](\d{1,2})(?:\s+\d{1,2}:\d{2})?\s*~\s*(?:(\d{4})[.\-/])?(\d{1,2})[.\-/](\d{1,2})/;
  const m = text.match(re);
  if (!m) return { start: null as string | null, end: null as string | null };
  const y1 = m[1] ? Number(m[1]) : fallbackYear;
  const y2 = m[4] ? Number(m[4]) : y1;
  if (!y1) return { start: null, end: null };
  return {
    start: `${y1}-${pad2(m[2])}-${pad2(m[3])}`,
    end: y2 ? `${y2}-${pad2(m[5])}-${pad2(m[6])}` : null,
  };
}

const SUMMARY_LABEL =
  /^\[?(이익률|구매수|총매출|총광고비|광고비|판관비|상품원가|배송비|이익|roas|객단가|수수료|합계|소계|총계|순위|상품명|등록상품명|분류|구분|상품리스트)\]?$/i;

function pickQtyCol(cells: string[]): { idx: number; label: string } {
  const bad = /(목표|번들|재고|구성|월|평균|주단위|일단위|예상|계획)/;
  for (const pat of [/실판매량/, /판매수량/, /판매량/]) {
    const idx = cells.findIndex((c) => pat.test(norm(c)) && !bad.test(norm(c)));
    if (idx >= 0) return { idx, label: cells[idx].trim() };
  }
  return { idx: -1, label: "" };
}
function pickRevCol(cells: string[]): { idx: number; label: string } {
  const bad = /(총매출|목표|원가|광고|단품합|원가합)/;
  let idx = cells.findIndex((c) => /실매출/.test(norm(c)) && !bad.test(norm(c)));
  if (idx < 0)
    idx = cells.findIndex(
      (c) => (norm(c) === "매출" || /매출액/.test(norm(c))) && !bad.test(norm(c)),
    );
  return idx >= 0 ? { idx, label: cells[idx].trim() } : { idx: -1, label: "" };
}

export function parseCampaignGuide(buf: ArrayBuffer): GuideCampaign[] {
  const wb = XLSX.read(buf, { cellDates: true });
  const byCode = new Map<string, GuideCampaign>();

  const mergeIn = (b: GuideCampaign) => {
    if (b.products.length === 0) return;
    b.total_qty = b.products.reduce((s, p) => s + p.quantity, 0);
    b.total_revenue = b.products.reduce((s, p) => s + p.revenue, 0);
    const prev = byCode.get(b.code);
    if (!prev) byCode.set(b.code, b);
    else {
      prev.products.push(...b.products);
      prev.total_qty += b.total_qty;
      prev.total_revenue += b.total_revenue;
      if (!prev.end_date && b.end_date) prev.end_date = b.end_date;
      if (!prev.start_date && b.start_date) prev.start_date = b.start_date;
    }
  };

  // 모든 시트 스캔
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], {
      header: 1,
      blankrows: false,
      defval: "",
    }) as unknown[][];

    let cur: GuideCampaign | null = null;
    let colName = -1,
      colQty = -1,
      colRev = -1;

    const flush = () => {
      if (cur) mergeIn(cur);
      cur = null;
      colName = colQty = colRev = -1;
    };

    for (let i = 0; i < rows.length; i++) {
      const cells = Array.from(rows[i], (c) => String(c ?? "").trim());

      // 코드 셀(셀 시작이 CF_P_숫자) → 새 블록 또는 같은 코드면 유지
      const codeCellRaw = cells.find((c) => /^CF_P_\d{4,8}/i.test(c));
      const parsed = codeCellRaw ? codeFromCell(codeCellRaw) : null;
      if (parsed) {
        if (!cur || cur.code !== parsed.code) {
          flush();
          cur = {
            code: parsed.code,
            name: codeCellRaw!,
            start_date: dateFromDigits(parsed.digits),
            end_date: null,
            qty_label: "",
            rev_label: "",
            products: [],
            total_qty: 0,
            total_revenue: 0,
          };
        }
      }
      if (!cur) continue;

      // 기간
      if (!cur.end_date) {
        const joined = cells.join(" ");
        if (/~/.test(joined) && /\d{1,2}[.\-/]\d{1,2}/.test(joined)) {
          const yearGuess = yearFromDigits(cur.code.replace(/^CF_P_/i, ""));
          const { start, end } = parsePeriod(joined, yearGuess);
          if (start) {
            cur.start_date = start;
            cur.end_date = end;
          }
        }
      }

      // 상품표 헤더
      if (colQty < 0) {
        const nameIdx = cells.findIndex((c) => norm(c).includes("상품명"));
        const qty = pickQtyCol(cells);
        const rev = pickRevCol(cells);
        if (nameIdx >= 0 && qty.idx >= 0 && rev.idx >= 0) {
          colName = nameIdx;
          colQty = qty.idx;
          colRev = rev.idx;
          cur.qty_label = qty.label;
          cur.rev_label = rev.label;
          continue;
        }
      } else {
        const name = (cells[colName] ?? "").trim();
        const qty = toNum(rows[i][colQty]);
        const rev = toNum(rows[i][colRev]);
        if (name && !SUMMARY_LABEL.test(name) && (qty > 0 || rev > 0)) {
          cur.products.push({ name, quantity: qty, revenue: rev });
        }
      }
    }
    flush();
  }

  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}
