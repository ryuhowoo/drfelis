import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// N11: 상품(품목)을 정기구독으로 지정/해제. 구독 매출은 달성률 계산에서 제외되고 별도 표기됨.
// 전역 속성(모든 캠페인 공통) → 변경 시 사전계산(롤업) 갱신.
export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as {
      product_id?: unknown;
      is_subscription?: unknown;
    };
    if (!body.product_id || typeof body.product_id !== "string") {
      return NextResponse.json({ error: "product_id 필요" }, { status: 400 });
    }
    const supabase = await createClient();
    const { error } = await supabase
      .from("products")
      .update({ is_subscription: !!body.is_subscription })
      .eq("id", body.product_id);
    if (error) throw error;

    await supabase.rpc("refresh_rollups", { p_force: true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "저장 실패" },
      { status: 500 },
    );
  }
}
