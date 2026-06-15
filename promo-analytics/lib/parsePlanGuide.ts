import * as XLSX from "xlsx";

// 표준 '캠페인 플랜 가이드' 양식 파서 — 평평한 한 표(1행 = 옵션 1개).
// 가이드(가설) → 캠페인 플랜(예상)으로 적재하기 위한 입력.

// 한 옵션을 구성하는 단일 SKU(품목) 1건. 단품 옵션은 components 길이 1, 혼합 옵션은 N.
export type PlanComponent = {
  item_code: string; // 품목코드 (products.dr_code 매칭 키). 없으면 name 으로 매칭.
  name: string; // 이름 폴백 (단품 옵션명 등). 구성 컬럼에서 온 경우 빈 문자열.
  qty: number; // 이 SKU 의 옵션당 수량 (sku_qty_per_option)
};

export type PlanGuideOption = {
  product_code: string; // 상품코드
  item_code: string; // 품목코드 (products.dr_code 매칭 키)
  option_label: string; // 상품명(옵션명, 개입수 포함)
  pack_count: number; // 개입수 (옵션명에서 파싱)
  components: PlanComponent[]; // N7: 구성(다구성 지원). 단품이면 1건.
  expected_qty: number; // 수량(예상 판매수량, 옵션)
  consumer_price: number;
  cost: number;
  regular_price: number;
  promo_price: number; // 프로모션가
  coupon_price: number; // 쿠폰혜택가
  set_price: number; // 최종가 = 쿠폰혜택가 || 프로모션가
  discount_consumer: number | null; // 소비자가 대비
  discount_regular: number | null; // 상시가 대비 (메인 판정 기준)
  is_main: boolean; // 상시가 할인율 ≥ 15%
  target_revenue: number; // 목표매출
  total_cost: number; // 총원가
  logistics: number; // 물류비
  fee: number; // 수수료
  ad_cost: number; // 광고비
  contribution: number; // 공헌이익
  contribution_rate: number | null; // 공헌이익률
};

export type PlanGuideCampaign = {
  code: string;
  start_date: string | null;
  end_date: string | null;
  options: PlanGuideOption[];
  total_qty: number;
  total_target_revenue: number;
  main_count: number;
};

function norm(s: unknown): string {
  return String(s ?? "").replace(/\s+/g, "").replace(/[()[\]/+_.%]/g, "").toLowerCase();
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
// '35%' → 0.35, '0%' → 0, '0.35' → 0.35, 빈칸 → null(계산으로 폴백)
function parsePct(v: unknown): number | null {
  if (v == null || v === "" || v === "-") return null;
  const n = toNum(v);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}
function toDateStr(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date)
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  // 공백 제거 — '2026. 6. 14.'(점·공백 혼용)도 인식
  const s = String(v).replace(/\s+/g, "").trim();
  const m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  const d = new Date(String(v).trim());
  return isNaN(d.getTime())
    ? null
    : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function findCol(header: unknown[], cands: string[]): number {
  const normed = Array.from(header, norm);
  for (let i = 0; i < normed.length; i++)
    if (cands.some((c) => normed[i] === norm(c))) return i;
  // 부분일치 fallback
  for (let i = 0; i < normed.length; i++)
    if (cands.some((c) => normed[i].includes(norm(c)) && normed[i] !== "")) return i;
  return -1;
}

// '구성' 컬럼 파싱 (A안): "품목코드:수량, 품목코드:수량" → 컴포넌트 배열.
// 구분자 관용: 항목 = 콤마/세미콜론/줄바꿈, 코드↔수량 = ':' '*' 'x' '×' '@'. 수량 생략 시 1.
function parseComponents(raw: unknown): PlanComponent[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  const out: PlanComponent[] = [];
  for (const part of s.split(/[,;\n]+/)) {
    const seg = part.trim();
    if (!seg) continue;
    const m = seg.match(/^(.+?)\s*[:*x×@]\s*([\d.]+)\s*$/i);
    const code = (m ? m[1] : seg).trim();
    const qty = m ? Math.max(1, toNum(m[2]) || 1) : 1;
    if (code) out.push({ item_code: code, name: "", qty });
  }
  return out;
}

// 옵션명에서 개입수(번들 SKU 수) 추정: [4팩], 2박스, 6팩, N입/개/묶음/구성 → N. 없으면 1.
function packFromName(name: string): number {
  const m = name.match(/(\d+)\s*(팩|박스|입|개입|묶음|구성|개)\b/);
  if (m) return Math.max(1, Number(m[1]) || 1);
  const lead = name.match(/^\s*\[?\s*(\d+)\s*(팩|박스|입|개|묶음|구성)/);
  return lead ? Math.max(1, Number(lead[1]) || 1) : 1;
}

// xlsx는 바이너리로, CSV(텍스트)는 UTF-8로 디코드해 읽는다.
// XLSX.read(ArrayBuffer)는 CSV를 UTF-8로 디코드하지 않아 한글 헤더가 깨지므로 분기.
function readWorkbook(buf: ArrayBuffer): XLSX.WorkBook {
  const bytes = new Uint8Array(buf);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // 'PK' = xlsx(zip)
  if (isZip) return XLSX.read(buf, { cellDates: true });
  let text = new TextDecoder("utf-8").decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM 제거
  return XLSX.read(text, { type: "string", cellDates: true });
}

export function parsePlanGuide(buf: ArrayBuffer): PlanGuideCampaign[] {
  const wb = readWorkbook(buf);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    blankrows: false,
    defval: "",
  }) as unknown[][];

  // 헤더 행: 코드+상품명+수량+프로모션가가 가장 많이 매칭되는 상단 행
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const n = rows[i].map(norm);
    const score = ["코드", "상품명", "수량", "프로모션가"].filter((k) =>
      n.some((c) => c.includes(norm(k))),
    ).length;
    if (score >= 3) {
      h = i;
      break;
    }
  }
  if (h < 0)
    throw new Error(
      "플랜 가이드 헤더를 찾을 수 없습니다 (코드·상품명·수량·프로모션가 컬럼 필요). 표준 템플릿을 사용하세요.",
    );
  const H = rows[h];
  // '수량'이 두 번 나오는 실제 양식: 첫 수량=개입수(번들 SKU 수), 둘째 수량=예상 판매수량.
  // 명시 헤더(개입수/예상수량)가 있으면 우선.
  const qtyCols: number[] = [];
  H.forEach((cell, i) => {
    if (norm(cell) === "수량") qtyCols.push(i);
  });
  let packIdx = findCol(H, ["개입수", "번들수량"]);
  let qtyIdx = findCol(H, ["예상수량"]);
  if (qtyIdx < 0) qtyIdx = qtyCols.length >= 2 ? qtyCols[1] : (qtyCols[0] ?? -1);
  if (packIdx < 0) packIdx = qtyCols.length >= 2 ? qtyCols[0] : -1;
  // 할인율 컬럼(프로모션/쿠폰 두 쌍 가능). 최종(쿠폰=마지막) 값을 입력값으로 사용.
  const regDiscCols: number[] = [];
  const conDiscCols: number[] = [];
  H.forEach((cell, i) => {
    const nn = norm(cell);
    if (nn.includes("상시가할인율")) regDiscCols.push(i);
    else if (nn.includes("소비자가할인율")) conDiscCols.push(i);
  });
  const c = {
    code: findCol(H, ["코드", "프로모션코드", "캠페인코드"]),
    start: findCol(H, ["시작일", "시작"]),
    end: findCol(H, ["종료일", "종료"]),
    pcode: findCol(H, ["상품코드"]),
    icode: findCol(H, ["품목코드"]),
    name: findCol(H, ["상품명", "옵션명"]),
    components: findCol(H, ["구성", "구성품", "구성내역", "구성품목"]),
    qty: qtyIdx,
    pack: packIdx,
    consumer: findCol(H, ["소비자가"]),
    cost: findCol(H, ["원가"]),
    regular: findCol(H, ["상시가"]),
    promo: findCol(H, ["프로모션가"]),
    coupon: findCol(H, ["쿠폰혜택가", "쿠폰가"]),
    target: findCol(H, ["목표매출"]),
    totalCost: findCol(H, ["총원가"]),
    logistics: findCol(H, ["물류비"]),
    fee: findCol(H, ["수수료"]),
    ad: findCol(H, ["광고비"]),
    contrib: findCol(H, ["공헌이익률"]) >= 0 ? findCol(H, ["공헌이익"]) : findCol(H, ["공헌이익"]),
    contribRate: findCol(H, ["공헌이익률"]),
    discReg: regDiscCols.length ? regDiscCols[regDiscCols.length - 1] : -1,
    discCon: conDiscCols.length ? conDiscCols[conDiscCols.length - 1] : -1,
  };

  const byCode = new Map<string, PlanGuideCampaign>();
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    const code = String(r[c.code] ?? "").trim().toUpperCase();
    const name = String(r[c.name] ?? "").trim();
    if (!/^CF_P_/i.test(code) || !name) continue;

    const consumer = toNum(r[c.consumer]);
    const regular = toNum(r[c.regular]);
    const promo = toNum(r[c.promo]);
    const coupon = c.coupon >= 0 ? toNum(r[c.coupon]) : 0;
    const set_price = coupon > 0 ? coupon : promo;
    // 입력 할인율 우선, 비면 가격으로 계산
    const regEntered = c.discReg >= 0 ? parsePct(r[c.discReg]) : null;
    const conEntered = c.discCon >= 0 ? parsePct(r[c.discCon]) : null;
    const dRegular = regEntered ?? (regular > 0 ? (regular - set_price) / regular : null);
    const dConsumer = conEntered ?? (consumer > 0 ? (consumer - set_price) / consumer : null);
    const contribRate = c.contribRate >= 0 ? toNum(r[c.contribRate]) : 0;

    const packVal = c.pack >= 0 ? toNum(r[c.pack]) : 0;
    const pack_count = packVal > 0 ? packVal : packFromName(name);
    const item_code = c.icode >= 0 ? String(r[c.icode] ?? "").trim() : "";
    // 구성 컬럼이 있고 값이 있으면 다구성으로, 없으면 현행 단품(품목코드 또는 옵션명) 1건.
    const parsed = c.components >= 0 ? parseComponents(r[c.components]) : [];
    const components: PlanComponent[] =
      parsed.length > 0
        ? parsed
        : [{ item_code, name: item_code ? "" : name, qty: pack_count }];
    const opt: PlanGuideOption = {
      product_code: c.pcode >= 0 ? String(r[c.pcode] ?? "").trim() : "",
      item_code,
      option_label: name,
      pack_count,
      components,
      expected_qty: toNum(r[c.qty]),
      consumer_price: consumer,
      cost: toNum(r[c.cost]),
      regular_price: regular,
      promo_price: promo,
      coupon_price: coupon,
      set_price,
      discount_consumer: dConsumer,
      discount_regular: dRegular,
      is_main: dRegular != null && dRegular >= 0.15,
      target_revenue: c.target >= 0 ? toNum(r[c.target]) : 0,
      total_cost: c.totalCost >= 0 ? toNum(r[c.totalCost]) : 0,
      logistics: c.logistics >= 0 ? toNum(r[c.logistics]) : 0,
      fee: c.fee >= 0 ? toNum(r[c.fee]) : 0,
      ad_cost: c.ad >= 0 ? toNum(r[c.ad]) : 0,
      contribution: c.contrib >= 0 ? toNum(r[c.contrib]) : 0,
      contribution_rate: contribRate || null,
    };

    let camp = byCode.get(code);
    if (!camp) {
      camp = {
        code,
        start_date: c.start >= 0 ? toDateStr(r[c.start]) : null,
        end_date: c.end >= 0 ? toDateStr(r[c.end]) : null,
        options: [],
        total_qty: 0,
        total_target_revenue: 0,
        main_count: 0,
      };
      byCode.set(code, camp);
    }
    camp.options.push(opt);
  }

  for (const camp of byCode.values()) {
    // 상시가 할인율 높은 순 정렬 (메인 우선 노출)
    camp.options.sort(
      (a, b) => (b.discount_regular ?? -1) - (a.discount_regular ?? -1),
    );
    camp.total_qty = camp.options.reduce((s, o) => s + o.expected_qty, 0);
    camp.total_target_revenue = camp.options.reduce((s, o) => s + o.target_revenue, 0);
    camp.main_count = camp.options.filter((o) => o.is_main).length;
  }

  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}
