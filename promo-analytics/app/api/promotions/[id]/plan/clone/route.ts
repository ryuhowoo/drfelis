import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// 확정본 수정 = 새 버전: promo.clone_plan_as_draft → 새 draft id 반환
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { plan_id } = (await req.json()) as { plan_id: string };
    const supabase = await createClient();

    const { data: plan } = await supabase
      .from("campaign_plans")
      .select("id")
      .eq("id", plan_id)
      .eq("promotion_id", id)
      .single();
    if (!plan)
      return NextResponse.json({ error: "플랜을 찾을 수 없습니다" }, { status: 404 });

    const { data, error } = await supabase.rpc("clone_plan_as_draft", {
      p_plan_id: plan_id,
    });
    if (error) throw error;
    return NextResponse.json({ plan_id: data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "복제 실패" },
      { status: 500 },
    );
  }
}
