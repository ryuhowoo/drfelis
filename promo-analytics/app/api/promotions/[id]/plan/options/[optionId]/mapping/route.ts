import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// 옵션 매칭 패턴(match_patterns)만 수정. 사후 분석 메타데이터이므로 confirmed 플랜이어도 허용.
// (expected_*/frozen_* 등 다른 필드는 변경 경로 없음)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; optionId: string }> },
) {
  try {
    const { id, optionId } = await params;
    const body = (await req.json()) as { match_patterns?: unknown };
    const supabase = await createClient();

    // 옵션 → 플랜 → 이 캠페인 소속 확인
    const { data: opt } = await supabase
      .from("campaign_plan_options")
      .select("id, campaign_plan_id")
      .eq("id", optionId)
      .single();
    if (!opt)
      return NextResponse.json({ error: "옵션을 찾을 수 없습니다" }, { status: 404 });
    const { data: plan } = await supabase
      .from("campaign_plans")
      .select("id")
      .eq("id", opt.campaign_plan_id)
      .eq("promotion_id", id)
      .single();
    if (!plan)
      return NextResponse.json({ error: "플랜을 찾을 수 없습니다" }, { status: 404 });

    const clean = Array.isArray(body.match_patterns)
      ? [
          ...new Set(
            body.match_patterns
              .map((s) => String(s).trim())
              .filter((s) => s.length > 0),
          ),
        ]
      : [];

    const { error } = await supabase
      .from("campaign_plan_options")
      .update({ match_patterns: clean, updated_at: new Date().toISOString() })
      .eq("id", optionId);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "매핑 저장 실패" },
      { status: 500 },
    );
  }
}
