import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseDailySales } from "@/lib/parse";
import { ensureProducts, chunk } from "@/lib/products";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });

    const rows = parseDailySales(await file.arrayBuffer());
    if (rows.length === 0)
      return NextResponse.json({ error: "유효한 행이 없습니다." }, { status: 400 });

    const supabase = await createClient();
    const productMap = await ensureProducts(
      supabase,
      rows.map((r) => r.base_name),
    );

    const records = rows.map((r) => ({
      sale_date: r.sale_date,
      product_id: productMap.get(r.base_name) ?? null,
      base_name: r.base_name,
      option_info: r.option_info,
      revenue: r.revenue,
      quantity: r.quantity,
      source_file: file.name,
    }));

    let upserted = 0;
    for (const batch of chunk(records, 1000)) {
      const { error } = await supabase
        .from("daily_sales")
        .upsert(batch, { onConflict: "sale_date,base_name,option_info" });
      if (error) throw error;
      upserted += batch.length;
    }

    const dates = rows.map((r) => r.sale_date).sort();
    return NextResponse.json({
      ok: true,
      count: upserted,
      products: productMap.size,
      range: { from: dates[0], to: dates[dates.length - 1] },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "임포트 실패" },
      { status: 500 },
    );
  }
}
