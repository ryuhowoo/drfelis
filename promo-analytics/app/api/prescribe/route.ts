import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadCases } from "@/lib/cases";
import { prescribe } from "@/lib/predict";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { target_uplift, duration_days, season_tag } = await req.json();
    if (!target_uplift || !duration_days)
      return NextResponse.json(
        { error: "목표 증분과 기간을 입력하세요." },
        { status: 400 },
      );

    const supabase = await createClient();
    const cases = await loadCases(supabase);
    const recs = prescribe(
      Number(target_uplift),
      Number(duration_days),
      season_tag || null,
      cases,
    );
    return NextResponse.json({ recommendations: recs });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "처방 실패" },
      { status: 500 },
    );
  }
}
