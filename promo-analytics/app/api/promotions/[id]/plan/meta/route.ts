import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// N8 P3: 플랜 메타(자유 태그 · 메인 제품 지정) 수정.
// 사후 분석/추천용 메타데이터이므로 confirmed 플랜이어도 허용.
// main_product_ids 변경은 메인/함께구매 분해에 영향 → 롤업 강제 갱신.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      tags?: unknown;
      main_product_ids?: unknown;
    };
    const supabase = await createClient();

    // 이 캠페인의 현재 플랜
    const { data: plan } = await supabase
      .from("campaign_plans")
      .select("id")
      .eq("promotion_id", id)
      .eq("is_current", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!plan)
      return NextResponse.json({ error: "플랜을 찾을 수 없습니다" }, { status: 404 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (Array.isArray(body.tags)) {
      patch.tags = [
        ...new Set(
          body.tags.map((s) => String(s).trim()).filter((s) => s.length > 0),
        ),
      ];
    }

    let mainChanged = false;
    if (body.main_product_ids === null) {
      patch.main_product_ids = null; // null = 플랜 SKU 전체가 메인
      mainChanged = true;
    } else if (Array.isArray(body.main_product_ids)) {
      patch.main_product_ids = [
        ...new Set(body.main_product_ids.map((s) => String(s))),
      ];
      mainChanged = true;
    }

    const { error } = await supabase
      .from("campaign_plans")
      .update(patch)
      .eq("id", plan.id);
    if (error) throw error;

    // 메인 지정이 바뀌면 메인/함께구매 분해가 달라짐 → 사전계산 갱신
    if (mainChanged) {
      await supabase.rpc("refresh_rollups", { p_force: true });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "저장 실패" },
      { status: 500 },
    );
  }
}
