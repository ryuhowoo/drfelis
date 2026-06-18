import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// 5단계 — 이전에 저장된 플랜을 새 캠페인의 draft에 적용(복사해서 수정 사용).
// clone_plan_as_draft는 같은 캠페인 내 버전 복제용 → 이건 '다른 캠페인의 플랜'을
// 이 캠페인의 현재 draft로 옮겨 담는다(옵션·구성·쿠폰 복사, 기존 draft 옵션 교체).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { source_plan_id } = (await req.json()) as { source_plan_id: string };
    if (!source_plan_id)
      return NextResponse.json({ error: "원본 플랜이 필요합니다" }, { status: 400 });
    const supabase = await createClient();

    // 대상 = 이 캠페인의 현재 draft
    const { data: target, error: tErr } = await supabase
      .from("campaign_plans")
      .select("id, status")
      .eq("promotion_id", id)
      .eq("is_current", true)
      .single();
    if (tErr || !target)
      return NextResponse.json({ error: "이 캠페인의 플랜을 찾을 수 없습니다" }, { status: 404 });
    if (target.status === "confirmed")
      return NextResponse.json(
        { error: "확정된 플랜에는 적용할 수 없습니다. '수정(새 버전)'으로 draft를 만드세요." },
        { status: 409 },
      );

    // 원본 플랜의 옵션 + 쿠폰
    const { data: srcPlan } = await supabase
      .from("campaign_plans")
      .select("coupon_min_order, coupon_rate, coupon_max")
      .eq("id", source_plan_id)
      .single();
    const { data: srcOpts, error: oErr } = await supabase
      .from("campaign_plan_options")
      .select("id, option_label, expected_option_qty, is_main, match_patterns, sort")
      .eq("campaign_plan_id", source_plan_id)
      .order("sort");
    if (oErr) throw oErr;
    if (!srcOpts || srcOpts.length === 0)
      return NextResponse.json({ error: "원본 플랜에 옵션이 없습니다" }, { status: 400 });

    const srcOptIds = srcOpts.map((o) => o.id);
    const { data: srcItems, error: iErr } = await supabase
      .from("campaign_plan_option_items")
      .select("campaign_plan_option_id, product_id, base_name, sku_qty_per_option, unit_sale_price, source_config_id, sort")
      .in("campaign_plan_option_id", srcOptIds);
    if (iErr) throw iErr;

    // 기존 draft 옵션 전체 교체 (아이템 cascade)
    const { error: delErr } = await supabase
      .from("campaign_plan_options")
      .delete()
      .eq("campaign_plan_id", target.id);
    if (delErr) throw delErr;

    // 옵션·아이템 복사 (frozen/rollup은 비우고 — 저장 시 라이브 재계산)
    for (const [idx, o] of srcOpts.entries()) {
      const { data: newOpt, error: niErr } = await supabase
        .from("campaign_plan_options")
        .insert({
          campaign_plan_id: target.id,
          option_label: o.option_label,
          expected_option_qty: o.expected_option_qty,
          is_main: o.is_main,
          match_patterns: o.match_patterns ?? [],
          sort: o.sort ?? idx,
        })
        .select("id")
        .single();
      if (niErr) throw niErr;
      const items = (srcItems ?? []).filter((it) => it.campaign_plan_option_id === o.id);
      if (items.length > 0) {
        const { error: insErr } = await supabase.from("campaign_plan_option_items").insert(
          items.map((it, i) => ({
            campaign_plan_option_id: newOpt.id,
            product_id: it.product_id,
            base_name: it.base_name,
            sku_qty_per_option: it.sku_qty_per_option,
            unit_sale_price: it.unit_sale_price,
            source_config_id: it.source_config_id ?? null,
            sort: it.sort ?? i,
          })),
        );
        if (insErr) throw insErr;
      }
    }

    // 쿠폰 복사
    await supabase
      .from("campaign_plans")
      .update({
        coupon_min_order: srcPlan?.coupon_min_order ?? 0,
        coupon_rate: srcPlan?.coupon_rate ?? 0,
        coupon_max: srcPlan?.coupon_max ?? 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", target.id);

    return NextResponse.json({ ok: true, options: srcOpts.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "플랜 적용 실패" },
      { status: 500 },
    );
  }
}
