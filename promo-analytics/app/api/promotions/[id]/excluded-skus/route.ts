import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// 품절(미판매) SKU 제외 토글 (피드백 1). 제외하면 플랜·성과·미매칭에서 빠진다.
// POST = 제외 추가, DELETE = 제외 해제. 변경 후 롤업 갱신.
async function mutate(
  id: string,
  product_id: string,
  op: "add" | "remove",
): Promise<{ error?: string }> {
  const supabase = await createClient();
  if (op === "add") {
    const { error } = await supabase
      .from("promotion_excluded_skus")
      .upsert({ promotion_id: id, product_id }, { onConflict: "promotion_id,product_id" });
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from("promotion_excluded_skus")
      .delete()
      .eq("promotion_id", id)
      .eq("product_id", product_id);
    if (error) return { error: error.message };
  }
  await supabase.rpc("refresh_rollups", { p_force: true });
  return {};
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { product_id } = (await req.json()) as { product_id?: string };
  if (!product_id) return NextResponse.json({ error: "product_id 필요" }, { status: 400 });
  const { error } = await mutate(id, product_id, "add");
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { product_id } = (await req.json()) as { product_id?: string };
  if (!product_id) return NextResponse.json({ error: "product_id 필요" }, { status: 400 });
  const { error } = await mutate(id, product_id, "remove");
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ ok: true });
}
