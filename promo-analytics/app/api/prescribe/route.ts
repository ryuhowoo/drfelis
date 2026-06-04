import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadCases } from "@/lib/cases";
import { recommendByGoal, type Goal } from "@/lib/predict";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { goal, target, duration_days, season_tag } = await req.json();
    const g = (goal as Goal) ?? "revenue";
    if (!duration_days)
      return NextResponse.json({ error: "기간을 입력하세요." }, { status: 400 });

    const supabase = await createClient();
    const cases = await loadCases(supabase);
    const recs = recommendByGoal(
      g,
      Number(target) || 0,
      Number(duration_days),
      season_tag || null,
      cases,
    );
    return NextResponse.json({ recommendations: recs });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "추천 실패" },
      { status: 500 },
    );
  }
}
