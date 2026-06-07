import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// 플랜 확정: promo.confirm_plan (동결 + 롤업 + current 플립, 트랜잭션)
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { plan_id } = (await req.json()) as { plan_id: string };
    const supabase = await createClient();

    // 소속 확인
    const { data: plan } = await supabase
      .from("campaign_plans")
      .select("id")
      .eq("id", plan_id)
      .eq("promotion_id", id)
      .single();
    if (!plan)
      return NextResponse.json({ error: "플랜을 찾을 수 없습니다" }, { status: 404 });

    const { error } = await supabase.rpc("confirm_plan", { p_plan_id: plan_id });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "확정 실패" },
      { status: 500 },
    );
  }
}
