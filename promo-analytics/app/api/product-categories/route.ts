import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// 상품 카테고리 마스터 관리. products.category(텍스트)가 값의 출처이고,
// product_categories 는 '관리 목록 + 정렬'. 이름 변경/병합 시 두 곳을 함께 갱신한다.

async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ? supabase : null;
}

export async function GET() {
  const supabase = await requireUser();
  if (!supabase) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: cats } = await supabase.from("product_categories").select("name, sort").order("sort");
  const { data: prods } = await supabase.from("products").select("category");
  const counts = new Map<string, number>();
  for (const p of prods ?? []) {
    const c = (p.category as string | null)?.trim();
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const list = (cats ?? []).map((c) => ({ name: c.name as string, count: counts.get(c.name as string) ?? 0 }));
  return NextResponse.json({ categories: list });
}

export async function POST(req: Request) {
  const supabase = await requireUser();
  if (!supabase) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { name } = (await req.json()) as { name?: string };
    const n = (name ?? "").trim();
    if (!n) return NextResponse.json({ error: "카테고리명을 입력하세요." }, { status: 400 });
    const { data: max } = await supabase
      .from("product_categories")
      .select("sort")
      .order("sort", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await supabase
      .from("product_categories")
      .insert({ name: n, sort: ((max?.sort as number | undefined) ?? 0) + 1 });
    if (error) return NextResponse.json({ error: error.message.includes("duplicate") ? "이미 있는 카테고리입니다." : error.message }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "생성 실패" }, { status: 500 });
  }
}

// 이름 변경/병합: from → to. to 가 이미 있으면 병합(from 행 삭제), 없으면 이름 변경.
export async function PATCH(req: Request) {
  const supabase = await requireUser();
  if (!supabase) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { from, to } = (await req.json()) as { from?: string; to?: string };
    const f = (from ?? "").trim();
    const t = (to ?? "").trim();
    if (!f || !t) return NextResponse.json({ error: "변경 전/후 이름이 필요합니다." }, { status: 400 });
    if (f === t) return NextResponse.json({ ok: true });

    // 1) 상품의 category 문자열 일괄 변경 (값의 출처)
    const { error: upErr } = await supabase.from("products").update({ category: t }).eq("category", f);
    if (upErr) throw upErr;

    // 2) 관리 목록 동기화
    const { data: existsTo } = await supabase.from("product_categories").select("name").eq("name", t).maybeSingle();
    if (existsTo) {
      // 병합 — from 행 삭제
      await supabase.from("product_categories").delete().eq("name", f);
    } else {
      const { error: rnErr } = await supabase.from("product_categories").update({ name: t }).eq("name", f);
      if (rnErr) throw rnErr;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "변경 실패" }, { status: 500 });
  }
}

// 삭제: 관리 목록에서 제거 + 해당 상품들 미지정(null)으로
export async function DELETE(req: Request) {
  const supabase = await requireUser();
  if (!supabase) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { name } = (await req.json()) as { name?: string };
    const n = (name ?? "").trim();
    if (!n) return NextResponse.json({ error: "이름 필요" }, { status: 400 });
    await supabase.from("products").update({ category: null }).eq("category", n);
    await supabase.from("product_categories").delete().eq("name", n);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "삭제 실패" }, { status: 500 });
  }
}
