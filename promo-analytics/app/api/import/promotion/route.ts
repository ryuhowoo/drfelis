import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parsePromotionSheet, extractPromoCode } from "@/lib/parse";
import { ensureProducts, chunk } from "@/lib/products";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });

    const parsed = parsePromotionSheet(await file.arrayBuffer());
    if (parsed.rows.length === 0)
      return NextResponse.json({ error: "유효한 행이 없습니다." }, { status: 400 });
    if (!parsed.start_date || !parsed.end_date)
      return NextResponse.json(
        { error: "프로모션 기간을 시트에서 찾지 못했습니다. (일자 누적 컬럼 확인)" },
        { status: 400 },
      );

    const supabase = await createClient();
    const productMap = await ensureProducts(
      supabase,
      parsed.rows.map((r) => r.base_name),
    );

    // 시트명/파일명에서 프로모션명·코드 추출
    const rawName = file.name.replace(/\.(xlsx|xls|csv)$/i, "");
    const code = extractPromoCode(rawName);
    const name = code
      ? rawName.slice(rawName.indexOf(code))
      : rawName;

    // 프로모션 생성
    const { data: promo, error: pErr } = await supabase
      .from("promotions")
      .insert({
        name,
        code,
        start_date: parsed.start_date,
        end_date: parsed.end_date,
      })
      .select("id")
      .single();
    if (pErr) throw pErr;

    // 실적 적재
    const records = parsed.rows.map((r) => ({
      promotion_id: promo.id,
      product_id: productMap.get(r.base_name) ?? null,
      base_name: r.base_name,
      option_info: r.option_info,
      revenue: r.revenue,
      order_count: r.order_count,
      aov: r.aov,
      fee: r.fee,
      cost: r.cost,
      quantity: r.quantity,
    }));
    for (const batch of chunk(records, 1000)) {
      const { error } = await supabase.from("promotion_sales").insert(batch);
      if (error) throw error;
    }

    return NextResponse.json({
      ok: true,
      promotion_id: promo.id,
      name,
      period: { from: parsed.start_date, to: parsed.end_date },
      count: records.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "임포트 실패" },
      { status: 500 },
    );
  }
}
