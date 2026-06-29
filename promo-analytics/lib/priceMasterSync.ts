import * as XLSX from "xlsx";
import { parseItemMaster, parsePriceGuide } from "@/lib/parse";
import { chunk } from "@/lib/products";

// 품목/가격 마스터 — Google Sheets '웹에 게시(CSV)' 동기화 공용 로직.
// 단일 CSV 시트(품목코드·품목명·카테고리·원가(VAT+)·소비자가·상시가·2~5묶음가)를 받아
// products + product_price_configs 를 upsert 한다. 수동(클라이언트)·자동(크론) 양쪽에서 호출.
// window.confirm 없이 동작(서버 호환) — 같은 (품목×구성)은 최신값으로 덮어쓴다.

// 최소 인터페이스만 사용 — 클라이언트/서비스 클라이언트 모두 수용.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export type PriceMasterSyncResult = {
  items: number;
  configs: number;
  unmatched: number;
};

async function fetchMult(supabase: Db): Promise<number> {
  const { data } = await supabase
    .from("rate_card")
    .select("fee_rate, ad_rate, logistics_rate, reward_rate")
    .eq("is_current", true)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return 0.715;
  const sum =
    Number(data.fee_rate) +
    Number(data.ad_rate) +
    Number(data.logistics_rate) +
    Number(data.reward_rate);
  return 1 - sum;
}

function dedupBy<T>(arr: T[], key: (t: T) => string): T[] {
  const m = new Map<string, T>();
  for (const it of arr) m.set(key(it), it);
  return [...m.values()];
}

/** CSV 텍스트를 파싱해 products + product_price_configs 적재. 반환: 적재 건수 요약. */
export async function applyPriceMasterCsv(
  supabase: Db,
  csvText: string,
  fileName: string,
): Promise<PriceMasterSyncResult> {
  const wb = XLSX.read(csvText, { type: "string" });
  const sheet = wb.SheetNames[0];
  if (!sheet) throw new Error("CSV에 시트가 없습니다.");

  const mult = await fetchMult(supabase);
  const item = parseItemMaster(wb, sheet);
  const lookup = new Map(
    item.rows
      .filter((r) => r.dr_code)
      .map((r) => [
        r.dr_code as string,
        { cost: r.cost, consumer_price: r.consumer_price, regular_price: r.regular_price },
      ]),
  );
  const guide = parsePriceGuide(wb, sheet, { mult, lookup });
  if (item.rows.length === 0 && guide.configs.length === 0)
    throw new Error("적재할 품목·구성이 없습니다. 헤더(품목코드·소비자가)를 확인하세요.");

  // 1) 품목 upsert
  const itemPayload = dedupBy(item.rows, (r) => r.base_name).map((r) => ({
    base_name: r.base_name,
    dr_code: r.dr_code,
    cost: r.cost,
    cost_vat_excluded: r.cost_vat_excluded,
    consumer_price: r.consumer_price,
    regular_price: r.regular_price,
  }));
  if (itemPayload.length > 0) {
    const { error } = await supabase
      .from("products")
      .upsert(itemPayload, { onConflict: "base_name" });
    if (error) throw new Error(error.message);
  }

  // 2) product_id 해석 맵
  const { data: allProducts, error: pErr } = await supabase
    .from("products")
    .select("id, base_name, dr_code");
  if (pErr) throw new Error(pErr.message);
  const byDr = new Map<string, { id: string; base_name: string }>();
  const byBase = new Map<string, { id: string; base_name: string }>();
  for (const pr of allProducts ?? []) {
    const v = { id: pr.id as string, base_name: pr.base_name as string };
    if (pr.dr_code) byDr.set(pr.dr_code as string, v);
    byBase.set(pr.base_name as string, v);
  }

  // 3) 카테고리 갱신 (가이드 → products.category)
  const catByDr = new Map<string, string>();
  const catByBase = new Map<string, string>();
  for (const c of guide.categories) {
    if (c.dr_code) catByDr.set(c.dr_code, c.category);
    if (c.base_name) catByBase.set(c.base_name, c.category);
  }
  const catPayload: { base_name: string; category: string }[] = [];
  for (const pr of allProducts ?? []) {
    const cat =
      (pr.dr_code && catByDr.get(pr.dr_code as string)) || catByBase.get(pr.base_name as string);
    if (cat) catPayload.push({ base_name: pr.base_name as string, category: cat });
  }
  if (catPayload.length > 0) {
    const { error } = await supabase
      .from("products")
      .upsert(catPayload, { onConflict: "base_name" });
    if (error) throw new Error(error.message);
  }

  // 4) configs 해석 + 중복 제거
  const recMap = new Map<string, Record<string, unknown>>();
  let unmatched = 0;
  for (const c of guide.configs) {
    const match =
      (c.dr_code && byDr.get(c.dr_code)) || (c.base_name && byBase.get(c.base_name)) || null;
    if (!match) {
      unmatched++;
      continue;
    }
    recMap.set(`${match.id}::${c.config_type}`, {
      product_id: match.id,
      base_name: match.base_name,
      sale_mode: "상시",
      config_type: c.config_type,
      pack_count: c.pack_count,
      free_shipping: c.free_shipping,
      list_price: c.list_price,
      sale_price: c.sale_price,
      discount_rate_consumer: c.discount_rate_consumer,
      discount_rate_regular: c.discount_rate_regular,
      unit_cost_total: c.unit_cost_total,
      contribution: c.contribution,
      contribution_rate: c.contribution_rate,
      source_file: fileName,
    });
  }
  const records = [...recMap.values()];

  // 5) upsert by (product_id, config_type)
  for (const batch of chunk(records, 500)) {
    const { error } = await supabase
      .from("product_price_configs")
      .upsert(batch, { onConflict: "product_id,sale_mode,config_type" });
    if (error) throw new Error(error.message);
  }

  // 6) 중복 product 자동 치유 — 같은 dr_code 가 이름만 달라 2행으로 들어온 경우 1행으로 병합(0071).
  //    매칭은 product 이름 정규화로 이뤄져, 카탈로그명/적재명이 다르면 '플랜만·성과만' 고아가 생기므로
  //    코드 기준으로 재발을 막는다. best-effort: 함수 미적용 환경에서도 동기화는 성공.
  try {
    await supabase.rpc("merge_dup_products_by_code");
  } catch {
    /* 0071 미적용 등 무시 */
  }

  return { items: itemPayload.length, configs: records.length, unmatched };
}

/** sheet_sync에 등록된 CSV URL을 fetch → applyPriceMasterCsv → 상태 기록. */
export async function runPriceMasterSync(
  supabase: Db,
  opts?: { csvUrl?: string },
): Promise<PriceMasterSyncResult & { csvUrl: string }> {
  let csvUrl = opts?.csvUrl ?? "";
  if (!csvUrl) {
    const { data } = await supabase.from("sheet_sync").select("csv_url, enabled").eq("id", 1).maybeSingle();
    if (!data?.csv_url) throw new Error("등록된 CSV URL이 없습니다. 먼저 시트 URL을 저장하세요.");
    csvUrl = data.csv_url as string;
  }

  try {
    const res = await fetch(csvUrl, { redirect: "follow" });
    if (!res.ok) throw new Error(`CSV fetch 실패 (HTTP ${res.status})`);
    const text = await res.text();
    const out = await applyPriceMasterCsv(supabase, text, "google-sheet");
    await supabase
      .from("sheet_sync")
      .update({
        csv_url: csvUrl,
        last_synced_at: new Date().toISOString(),
        last_status: "ok",
        last_row_count: out.configs,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    return { ...out, csvUrl };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from("sheet_sync")
      .update({ last_synced_at: new Date().toISOString(), last_status: `error: ${msg}`.slice(0, 300), updated_at: new Date().toISOString() })
      .eq("id", 1);
    throw e;
  }
}
