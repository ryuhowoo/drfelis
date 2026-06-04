import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const supabase = await createClient();

    const { main_product_ids, ...fields } = body as {
      main_product_ids?: string[];
      [k: string]: unknown;
    };

    // 메타 갱신 (허용 필드만)
    const allowed = [
      "name",
      "purpose",
      "purposes",
      "promo_type",
      "promo_types",
      "season_tag",
      "channel",
      "benefits",
      "contribution_amount",
      "notes",
      "start_date",
      "end_date",
    ];
    const update: Record<string, unknown> = {};
    for (const k of allowed) if (k in fields) update[k] = fields[k];
    if (Object.keys(update).length > 0) {
      const { error } = await supabase
        .from("promotions")
        .update(update)
        .eq("id", id);
      if (error) throw error;
    }

    // 메인상품 재설정 (전체 교체)
    if (Array.isArray(main_product_ids)) {
      await supabase
        .from("promotion_main_products")
        .delete()
        .eq("promotion_id", id);
      if (main_product_ids.length > 0) {
        const { error } = await supabase
          .from("promotion_main_products")
          .insert(
            main_product_ids.map((pid) => ({
              promotion_id: id,
              product_id: pid,
            })),
          );
        if (error) throw error;
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "수정 실패" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { error } = await supabase.from("promotions").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "삭제 실패" },
      { status: 500 },
    );
  }
}
