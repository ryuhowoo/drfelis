import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadCases } from "@/lib/cases";
import { recommendByGoals, type Goal, type GoalTarget } from "@/lib/predict";

export const runtime = "nodejs";

const VALID_GOALS: Goal[] = ["revenue", "stock", "branding"];

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { duration_days, season_tag } = body as {
      duration_days?: number;
      season_tag?: string | null;
    };
    if (!duration_days)
      return NextResponse.json({ error: "기간을 입력하세요." }, { status: 400 });

    // 신·구 입력 모두 수용
    // - 신: goal_targets: [{ goal, target }]
    // - 구: goal + target (단일)
    let goalTargets: GoalTarget[] = [];
    if (Array.isArray(body.goal_targets)) {
      goalTargets = (body.goal_targets as unknown[])
        .map((g) => {
          if (typeof g !== "object" || g === null) return null;
          const o = g as Record<string, unknown>;
          const goal = o.goal as Goal;
          if (!VALID_GOALS.includes(goal)) return null;
          return { goal, target: Number(o.target) || 0 } as GoalTarget;
        })
        .filter((x): x is GoalTarget => x !== null);
    }
    if (goalTargets.length === 0 && body.goal && VALID_GOALS.includes(body.goal)) {
      goalTargets = [{ goal: body.goal as Goal, target: Number(body.target) || 0 }];
    }
    if (goalTargets.length === 0)
      return NextResponse.json({ error: "목표를 하나 이상 선택하세요." }, { status: 400 });

    const supabase = await createClient();
    const cases = await loadCases(supabase);
    const recs = recommendByGoals(
      goalTargets,
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
