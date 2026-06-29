import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// 상품(SKU) 마스터 직접 편집 — 가격 가이드 웹 편집기(웹이 단일 출처).
// POST=신규, PATCH=수정(허용 필드만), DELETE=삭제(참조 중이면 거부). 인증 필요.

const NUMERIC = new Set(["cost", "consumer_price", "regular_price", "cost_vat_excluded"]);
const ALLOWED = [
  "base_name",
  "dr_code",
  "category",
  "brand",
  "cost",
  "consumer_price",
  "regular_price",
  "cost_vat_excluded",
  "is_subscription",
];

function clean(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ALLOWED) {
    if (!(k in body)) continue;
    const v = body[k];
    if (k === "is_subscription") out[k] = !!v;
    else if (NUMERIC.has(k)) {
      const s = String(v ?? "").replace(/[^0-9.-]/g, "");
      out[k] = s.trim() === "" ? null : Number(s);
    } else {
      const s = typeof v === "string" ? v.trim() : v;
      out[k] = s === "" ? null : s;
    }
  }
  return out;
}

async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ? supabase : null;
}

export async function POST(req: Request) {
  const supabase = await requireUser();
  if (!supabase) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const fields = clean(body);
    const name = String(fields.base_name ?? "").trim();
    if (!name) return NextResponse.json({ error: "상품명을 입력하세요." }, { status: 400 });

    // 같은 dr_code 가 이미 있으면 중복 생성 방지(코드가 단일 식별자)
    const code = (fields.dr_code as string | null) ?? null;
    if (code) {
      const { data: dup } = await supabase.from("products").select("id").eq("dr_code", code).maybeSingle();
      if (dup) return NextResponse.json({ error: `상품코드 ${code} 가 이미 존재합니다.` }, { status: 409 });
    }
    const { data, error } = await supabase.from("products").insert(fields).select("id").single();
    if (error) throw error;
    return NextResponse.json({ ok: true, id: data.id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "생성 실패" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const supabase = await requireUser();
  if (!supabase) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = (await req.json()) as Record<string, unknown> & { id?: string; ids?: string[] };
    // 일괄 카테고리 지정: { ids: [...], category } — 미분류 상품 대량 정리용
    if (Array.isArray(body.ids)) {
      if (body.ids.length === 0) return NextResponse.json({ ok: true });
      const cat = typeof body.category === "string" && body.category.trim() ? body.category.trim() : null;
      const { error } = await supabase.from("products").update({ category: cat }).in("id", body.ids);
      if (error) throw error;
      return NextResponse.json({ ok: true, updated: body.ids.length });
    }
    const id = body.id;
    if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });
    const fields = clean(body);
    if ("base_name" in fields && !String(fields.base_name ?? "").trim())
      return NextResponse.json({ error: "상품명은 비울 수 없습니다." }, { status: 400 });
    // dr_code 변경 시 다른 상품과 중복 금지
    if (fields.dr_code) {
      const { data: dup } = await supabase
        .from("products")
        .select("id")
        .eq("dr_code", fields.dr_code as string)
        .neq("id", id)
        .maybeSingle();
      if (dup) return NextResponse.json({ error: `상품코드 ${fields.dr_code} 가 다른 상품에 이미 있습니다.` }, { status: 409 });
    }
    if (Object.keys(fields).length === 0) return NextResponse.json({ ok: true });
    const { error } = await supabase.from("products").update(fields).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "수정 실패" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const supabase = await requireUser();
  if (!supabase) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { id } = (await req.json()) as { id?: string };
    if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });
    // 판매·플랜·일별매출 등에서 사용 중이면 삭제 거부(데이터 보호) — 가격 구성은 함께 정리
    const [sales, planItems, daily, seg] = await Promise.all([
      supabase.from("promotion_sales").select("id", { count: "exact", head: true }).eq("product_id", id),
      supabase.from("campaign_plan_option_items").select("id", { count: "exact", head: true }).eq("product_id", id),
      supabase.from("daily_sales").select("id", { count: "exact", head: true }).eq("product_id", id),
      supabase.from("promotion_segment_sales").select("id", { count: "exact", head: true }).eq("product_id", id),
    ]);
    const used = (sales.count ?? 0) + (planItems.count ?? 0) + (daily.count ?? 0) + (seg.count ?? 0);
    if (used > 0)
      return NextResponse.json(
        { error: `판매·플랜 데이터 ${used}건에서 사용 중이라 삭제할 수 없습니다. 코드/가격만 수정하세요.` },
        { status: 409 },
      );
    await supabase.from("product_price_configs").delete().eq("product_id", id);
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "삭제 실패" }, { status: 500 });
  }
}
