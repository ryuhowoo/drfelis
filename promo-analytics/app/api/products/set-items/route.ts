import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// 세트 구성(BOM) — (세트) 상품의 자식 SKU + 수량.
async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ? supabase : null;
}

export async function GET(req: Request) {
  const supabase = await requireUser();
  if (!supabase) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const setId = new URL(req.url).searchParams.get("set_id");
  if (!setId) return NextResponse.json({ error: "set_id 필요" }, { status: 400 });
  const { data } = await supabase
    .from("product_set_items")
    .select("id, child_product_id, qty, sort, child:products!product_set_items_child_product_id_fkey(base_name, dr_code, cost)")
    .eq("set_product_id", setId)
    .order("sort");
  const items = (data ?? []).map((r) => {
    const child = Array.isArray(r.child) ? r.child[0] : r.child;
    return {
      id: r.id as string,
      child_product_id: r.child_product_id as string,
      qty: r.qty as number,
      base_name: (child?.base_name as string) ?? "",
      dr_code: (child?.dr_code as string | null) ?? null,
      cost: (child?.cost as number | null) ?? null,
    };
  });
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const supabase = await requireUser();
  if (!supabase) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const b = (await req.json()) as { set_product_id?: string; child_product_id?: string; qty?: unknown };
    if (!b.set_product_id || !b.child_product_id)
      return NextResponse.json({ error: "set_product_id·child_product_id 필요" }, { status: 400 });
    if (b.set_product_id === b.child_product_id)
      return NextResponse.json({ error: "세트 자신을 구성으로 넣을 수 없습니다." }, { status: 400 });
    const qty = Math.max(1, Number(b.qty) || 1);
    const { error } = await supabase
      .from("product_set_items")
      .upsert(
        { set_product_id: b.set_product_id, child_product_id: b.child_product_id, qty },
        { onConflict: "set_product_id,child_product_id" },
      );
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
    const { error } = await supabase.from("product_set_items").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "삭제 실패" }, { status: 500 });
  }
}
