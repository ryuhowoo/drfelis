import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// 현재 캠페인 플랜의 비교 대상 실적 캠페인을 설정/해제.
// body: { actual_promotion_id: string | null }
//   null → 자기 캠페인 실적 사용 (기본)
//   값 있음 → 해당 캠페인의 promotion_sales 를 actuals 로 사용 (cross-campaign)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { actual_promotion_id?: string | null };
    const supabase = await createClient();

    // 현재 캠페인의 current plan 찾기 (draft / confirmed 모두 허용 — actuals link 는 메타정보)
    const { data: plan } = await supabase
      .from("campaign_plans")
      .select("id")
      .eq("promotion_id", id)
      .eq("is_current", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!plan) {
      return NextResponse.json(
        { error: "이 캠페인에 플랜이 없습니다. 플랜을 먼저 만들어주세요." },
        { status: 400 },
      );
    }

    const link =
      typeof body.actual_promotion_id === "string" &&
      body.actual_promotion_id.length > 0
        ? body.actual_promotion_id
        : null;

    if (link === id) {
      return NextResponse.json(
        { error: "자기 캠페인은 자동 연결되므로 다른 캠페인을 선택하세요." },
        { status: 400 },
      );
    }

    const { error } = await supabase
      .from("campaign_plans")
      .update({
        actual_promotion_id: link,
        updated_at: new Date().toISOString(),
      })
      .eq("id", plan.id);
    if (error) throw error;

    return NextResponse.json({ ok: true, actual_promotion_id: link });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "비교 대상 설정 실패" },
      { status: 500 },
    );
  }
}
