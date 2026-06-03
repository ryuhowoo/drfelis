import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadCases } from "@/lib/cases";
import { predict, type PredictionSpec } from "@/lib/predict";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const spec = (await req.json()) as PredictionSpec;
    if (!spec.duration_days || spec.duration_days < 1)
      return NextResponse.json({ error: "기간(일)을 입력하세요." }, { status: 400 });

    const supabase = await createClient();
    const cases = await loadCases(supabase);
    return NextResponse.json(predict(spec, cases));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "예측 실패" },
      { status: 500 },
    );
  }
}
