import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// SKU별 가격 구성(product_price_configs) 편집 — 단품/2~5묶음/정기 판매가.
// products.consumer_price/regular_price 기준으로 할인율을 자동 계산해 함께 저장.

const PACK: Record<string, number> = { 단품: 1, "2묶음": 2, "3묶음": 3, "4묶음": 4, "5묶음": 5, 정기: 1 };

async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ? supabase : null;
}

export async function GET(req: Request) {
  const supabase = await requireUser();
  if (!supabase) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const pid = new URL(req.url).searchParams.get("product_id");
  if (!pid) return NextResponse.json({ error: "product_id 필요" }, { status: 400 });
  const { data } = await supabase
    .from("product_price_configs")
    .select("id, config_type, pack_count, sale_price, list_price, free_shipping, discount_rate_consumer, discount_rate_regular")
    .eq("product_id", pid);
  return NextResponse.json({ configs: data ?? [] });
}

// 구성 추가/수정 (config_type 기준 upsert)
export async function POST(req: Request) {
  const supabase = await requireUser();
  if (!supabase) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const b = (await req.json()) as {
      product_id?: string;
      config_type?: string;
      sale_price?: unknown;
      list_price?: unknown;
      free_shipping?: unknown;
    };
    if (!b.product_id || !b.config_type)
      return NextResponse.json({ error: "product_id·config_type 필요" }, { status: 400 });
    const { data: prod } = await supabase
      .from("products")
      .select("base_name, consumer_price, regular_price")
      .eq("id", b.product_id)
      .maybeSingle();
    if (!prod) return NextResponse.json({ error: "상품을 찾을 수 없습니다." }, { status: 404 });

    const num = (v: unknown) => {
      const s = String(v ?? "").replace(/[^0-9.-]/g, "");
      return s.trim() === "" ? null : Number(s);
    };
    const sale = num(b.sale_price);
    const list = num(b.list_price);
    const consumer = prod.consumer_price as number | null;
    const regular = prod.regular_price as number | null;
    const row = {
      product_id: b.product_id,
      base_name: prod.base_name as string,
      config_type: b.config_type,
      pack_count: PACK[b.config_type] ?? 1,
      sale_price: sale,
      list_price: list,
      free_shipping: !!b.free_shipping,
      discount_rate_consumer: sale != null && consumer ? 1 - sale / (consumer * (PACK[b.config_type] ?? 1)) : null,
      discount_rate_regular: sale != null && regular ? 1 - sale / (regular * (PACK[b.config_type] ?? 1)) : null,
      source_file: "web",
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("product_price_configs")
      .upsert(row, { onConflict: "product_id,config_type" });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "저장 실패" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const supabase = await requireUser();
  if (!supabase) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { id } = (await req.json()) as { id?: string };
    if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });
    const { error } = await supabase.from("product_price_configs").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "삭제 실패" }, { status: 500 });
  }
}
