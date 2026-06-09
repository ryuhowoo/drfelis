import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// 한 캠페인의 SKU 매핑 목록
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("promotion_sku_mappings")
      .select("plan_product_id, actual_product_id, created_at")
      .eq("promotion_id", id);
    if (error) throw error;
    return NextResponse.json({ mappings: data ?? [] });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "조회 실패" },
      { status: 500 },
    );
  }
}

// 새 매핑 추가: { plan_product_id, actual_product_id }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      plan_product_id?: string;
      actual_product_id?: string;
    };
    if (!body.plan_product_id || !body.actual_product_id) {
      return NextResponse.json(
        { error: "plan_product_id 와 actual_product_id 가 필요합니다" },
        { status: 400 },
      );
    }
    if (body.plan_product_id === body.actual_product_id) {
      return NextResponse.json(
        { error: "같은 SKU 는 매핑할 필요가 없습니다" },
        { status: 400 },
      );
    }
    const supabase = await createClient();
    const { error } = await supabase.from("promotion_sku_mappings").insert({
      promotion_id: id,
      plan_product_id: body.plan_product_id,
      actual_product_id: body.actual_product_id,
    });
    if (error) {
      if (error.code === "23505")
        return NextResponse.json({ ok: true, duplicate: true });
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "매핑 추가 실패" },
      { status: 500 },
    );
  }
}

// 매핑 삭제: { plan_product_id, actual_product_id }
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      plan_product_id?: string;
      actual_product_id?: string;
    };
    if (!body.plan_product_id || !body.actual_product_id) {
      return NextResponse.json(
        { error: "plan_product_id 와 actual_product_id 가 필요합니다" },
        { status: 400 },
      );
    }
    const supabase = await createClient();
    const { error } = await supabase
      .from("promotion_sku_mappings")
      .delete()
      .eq("promotion_id", id)
      .eq("plan_product_id", body.plan_product_id)
      .eq("actual_product_id", body.actual_product_id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "매핑 삭제 실패" },
      { status: 500 },
    );
  }
}
