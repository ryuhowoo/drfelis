import * as XLSX from "xlsx";

// 자사몰 '프로모션 가이드' 워크북 파서 (전용 임포터).
// 한 시트에 캠페인 블록(CF_P 코드·기간·상품표)이 박스로 쌓여 있어, 평평한 매출 export와 다르다.
// 라벨 앵커(코드/프로모션일시/상품표 헤더)로 블록을 식별하고, 컬럼은 헤더 라벨로 런타임 탐지한다.

export type GuideProduct = {
  name: string; // 등록상품명
  quantity: number; // 판매수량
  revenue: number; // 매출
};

export type GuideCampaign = {
  code: string; // CF_P_YYMMDD
  name: string; // 블록 제목(있으면)
  start_date: string | null;
  end_date: string | null;
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

// CF_P_YYMMDD → YYYY-MM-DD (6자리 코드만; 4자리는 날짜 미상)
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

const SUMMARY_LABEL = /^\[?(이익률|구매수|총매출|총광고비|광고비|판관비|상품원가|배송비|이익|roas|객단가|수수료|합계|순위|상품명|등록상품명|소계|총계)\]?$/i;

export function parseCampaignGuide(buf: ArrayBuffer): GuideCampaign[] {
  const wb = XLSX.read(buf, { cellDates: true });

  // CF_P 코드가 가장 많이 등장하는 시트를 캠페인 블록 시트로 선택
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
  const campaigns: GuideCampaign[] = [];
  let cur: GuideCampaign | null = null;
  let colName = -1;
  let colQty = -1;
  let colRev = -1;

  const flush = () => {
    if (cur && cur.products.length > 0) {
      cur.total_qty = cur.products.reduce((s, p) => s + p.quantity, 0);
      cur.total_revenue = cur.products.reduce((s, p) => s + p.revenue, 0);
      campaigns.push(cur);
    }
    cur = null;
    colName = colQty = colRev = -1;
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cells = Array.from(row, (c) => String(c ?? "").trim());

    // 새 블록: 6자리 코드(CF_P_YYMMDD) 셀 등장
    const codeCell = cells.find((c) => /^CF_P_\d{6}$/i.test(c));
    if (codeCell) {
      flush();
      const title =
        cells.find((c) => /CF_P_\d{4,6}/i.test(c) && c.length > 12) ?? codeCell;
      cur = {
        code: codeCell.toUpperCase(),
        name: title,
        start_date: dateFromCode(codeCell),
        end_date: null,
        products: [],
        total_qty: 0,
        total_revenue: 0,
      };
    }
    if (!cur) continue;

    // 기간:MM/DD~MM/DD → 코드의 연도를 사용해 보정
    const periodCell = cells.find(
      (c) => c.includes("기간:") || /\d{1,2}\/\d{1,2}\s*~\s*\d{1,2}\/\d{1,2}/.test(c),
    );
    if (periodCell && cur.start_date) {
      const m = periodCell.match(/(\d{1,2})\/(\d{1,2})\s*~\s*(\d{1,2})\/(\d{1,2})/);
      if (m) {
        const year = cur.start_date.slice(0, 4);
        cur.start_date = `${year}-${pad2(m[1])}-${pad2(m[2])}`;
        cur.end_date = `${year}-${pad2(m[3])}-${pad2(m[4])}`;
      }
    }

    // 상품표 헤더 탐지 (상품명 + 판매수량 + 매출 이 한 행에)
    if (colQty < 0) {
      const nameIdx = cells.findIndex((c) => {
        const n = norm(c);
        return n.includes("상품명");
      });
      const qtyIdx = cells.findIndex((c) => norm(c).includes("판매수량"));
      const revIdx = cells.findIndex((c) => norm(c) === "매출" || norm(c).includes("매출액"));
      if (nameIdx >= 0 && qtyIdx >= 0 && revIdx >= 0) {
        colName = nameIdx;
        colQty = qtyIdx;
        colRev = revIdx;
        continue;
      }
    } else {
      // 상품 데이터 행
      const name = (cells[colName] ?? "").trim();
      const qty = toNum(row[colQty]);
      const rev = toNum(row[colRev]);
      if (name && !SUMMARY_LABEL.test(name) && (qty > 0 || rev > 0)) {
        cur.products.push({ name, quantity: qty, revenue: rev });
      }
    }
  }
  flush();

  // 같은 코드 블록이 여러 번 나오면 병합(상품 합산)
  const byCode = new Map<string, GuideCampaign>();
  for (const c of campaigns) {
    const prev = byCode.get(c.code);
    if (!prev) {
      byCode.set(c.code, c);
    } else {
      prev.products.push(...c.products);
      prev.total_qty += c.total_qty;
      prev.total_revenue += c.total_revenue;
      if (!prev.start_date && c.start_date) prev.start_date = c.start_date;
      if (!prev.end_date && c.end_date) prev.end_date = c.end_date;
    }
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}
