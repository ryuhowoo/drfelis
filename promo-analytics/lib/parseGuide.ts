import * as XLSX from "xlsx";

// 자사몰 '프로모션 가이드' 워크북 파서 (전용 임포터).
// 한 시트에 캠페인 블록(CF_P 코드 + 상품표)이 박스로 쌓여 있고, 연도/캠페인마다 표 양식이 다르다.
// 실적(판매수량/실판매량·매출/실매출)만 안전하게 읽고, 계획(목표)·구성(번들/재고)·상시(월/평균
// 판매량)는 명시적으로 제외한다. 라벨로 런타임 컬럼 탐지.

export type GuideProduct = {
  name: string;
  quantity: number;
  revenue: number;
};

export type GuideCampaign = {
  code: string; // CF_P_… (가능하면 6자리)
  name: string;
  start_date: string | null;
  end_date: string | null;
  qty_label: string; // 실제로 읽은 수량 컬럼 라벨 (검증용)
  rev_label: string; // 실제로 읽은 매출 컬럼 라벨
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

// 코드에서 연도 추출 (CF_P_YYMMDD 또는 CF_P_YYMM)
function yearFromCode(code: string): number | null {
  const m = code.match(/CF_P_(\d{2})/i);
  return m ? 2000 + Number(m[1]) : null;
}
function dateFromCode(code: string): string | null {
  const m = code.match(/CF_P_(\d{6})/i);
  if (!m) return null;
  const d = m[1];
  const year = 2000 + Number(d.slice(0, 2));
  const mm = Number(d.slice(2, 4));
  const dd = Number(d.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${year}-${pad2(mm)}-${pad2(dd)}`;
}

// "2024.08.05 (MON) ~ 08.09" / "02.15 14:00 ~ 02.20 23:59" / "05.27 ~ 05.31"
function parsePeriod(
  text: string,
  fallbackYear: number | null,
): { start: string | null; end: string | null } {
  const re =
    /(?:(\d{4})[.\-/])?(\d{1,2})[.\-/](\d{1,2})(?:\s+\d{1,2}:\d{2})?\s*~\s*(?:(\d{4})[.\-/])?(\d{1,2})[.\-/](\d{1,2})/;
  const m = text.match(re);
  if (!m) return { start: null, end: null };
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

// 수량 컬럼: 실판매량 > 판매수량 > 판매량. 목표·번들·재고·구성·월/평균/주/일 단위는 제외.
function pickQtyCol(cells: string[]): { idx: number; label: string } {
  const bad = /(목표|번들|재고|구성|월|평균|주단위|일단위|예상|계획)/;
  const priorities = [/실판매량/, /판매수량/, /판매량/];
  for (const pat of priorities) {
    const idx = cells.findIndex((c) => pat.test(norm(c)) && !bad.test(norm(c)));
    if (idx >= 0) return { idx, label: cells[idx].trim() };
  }
  return { idx: -1, label: "" };
}
// 매출 컬럼: 실매출 > 매출(단, 총매출/목표매출/원가/광고 제외)
function pickRevCol(cells: string[]): { idx: number; label: string } {
  const bad = /(총매출|목표|원가|광고|단품합|원가합)/;
  let idx = cells.findIndex((c) => norm(c) === "실매출");
  if (idx < 0)
    idx = cells.findIndex((c) => /실매출/.test(norm(c)) && !bad.test(norm(c)));
  if (idx < 0)
    idx = cells.findIndex(
      (c) => (norm(c) === "매출" || /매출액/.test(norm(c))) && !bad.test(norm(c)),
    );
  return idx >= 0 ? { idx, label: cells[idx].trim() } : { idx: -1, label: "" };
}
function pickNameCol(cells: string[]): number {
  return cells.findIndex((c) => norm(c).includes("상품명"));
}

export function parseCampaignGuide(buf: ArrayBuffer): GuideCampaign[] {
  const wb = XLSX.read(buf, { cellDates: true });

  // CF_P 코드가 가장 많은 시트 선택
  let bestSheet = "";
  let bestCount = -1;
  const grids: Record<string, unknown[][]> = {};
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], {
      header: 1,
      blankrows: false,
      defval: "",
    }) as unknown[][];
    grids[sn] = rows;
    let c = 0;
    for (const r of rows)
      for (const cell of r) if (/CF_P_\d{4,6}/i.test(String(cell))) c++;
    if (c > bestCount) {
      bestCount = c;
      bestSheet = sn;
    }
  }
  const rows = grids[bestSheet] ?? [];

  type Block = GuideCampaign & { _key: string };
  const blocks: Block[] = [];
  let cur: Block | null = null;
  let colName = -1,
    colQty = -1,
    colRev = -1;

  const finish = () => {
    if (cur && cur.products.length > 0) {
      cur.total_qty = cur.products.reduce((s, p) => s + p.quantity, 0);
      cur.total_revenue = cur.products.reduce((s, p) => s + p.revenue, 0);
      blocks.push(cur);
    }
    cur = null;
    colName = colQty = colRev = -1;
  };

  for (let i = 0; i < rows.length; i++) {
    const cells = Array.from(rows[i], (c) => String(c ?? "").trim());

    // 블록 시작/갱신: CF_P 코드 셀 (4~6자리)
    const codeCell = cells.find((c) => /^CF_P_\d{4,6}\b/i.test(c) || /^CF_P_\d{4,6}$/i.test(c));
    const codeMatch = codeCell?.match(/CF_P_\d{4,6}/i)?.[0]?.toUpperCase();
    if (codeMatch) {
      const key4 = codeMatch.replace(/^CF_P_/i, "").slice(0, 4); // YYMM 프리픽스
      const sameCampaign = cur && cur._key === key4;
      if (sameCampaign && cur) {
        // 같은 캠페인의 더 구체적인 코드(6자리)면 코드·날짜 보강
        if (codeMatch.length > cur.code.length) {
          cur.code = codeMatch;
          const d = dateFromCode(codeMatch);
          if (d) cur.start_date = d;
        }
      } else {
        finish();
        cur = {
          _key: key4,
          code: codeMatch,
          name: codeCell ?? codeMatch,
          start_date: dateFromCode(codeMatch),
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

    // 기간 (프로모션일시 행 등 어디서든)
    if (!cur.end_date) {
      const joined = cells.join(" ");
      if (/~/.test(joined) && /\d{1,2}[.\-/]\d{1,2}/.test(joined)) {
        const { start, end } = parsePeriod(joined, yearFromCode(cur.code));
        if (start) {
          cur.start_date = start;
          cur.end_date = end;
        }
      }
    }

    // 상품표 헤더 (상품명 + 실적 수량 + 실적 매출)
    if (colQty < 0) {
      const nameIdx = pickNameCol(cells);
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
  finish();

  // 같은 코드 병합
  const byCode = new Map<string, GuideCampaign>();
  for (const b of blocks) {
    const { _key, ...c } = b;
    void _key;
    const prev = byCode.get(c.code);
    if (!prev) byCode.set(c.code, c);
    else {
      prev.products.push(...c.products);
      prev.total_qty += c.total_qty;
      prev.total_revenue += c.total_revenue;
      if (!prev.end_date && c.end_date) prev.end_date = c.end_date;
    }
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}
