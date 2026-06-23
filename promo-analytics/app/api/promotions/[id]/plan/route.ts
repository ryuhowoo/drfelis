import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeOptionTotals, effectiveMult, type PlanItemInput } from "@/lib/plan";

export const runtime = "nodejs";

type ItemIn = {
  product_id: string;
  base_name: string;
  sku_qty_per_option: number;
  unit_sale_price: number;
  source_config_id?: string | null;
};
type OptionIn = {
  option_label: string;
  expected_option_qty: number;
  is_main?: boolean;
  match_patterns?: string[];
  sort?: number;
  items: ItemIn[];
};

// N5: POST(빈 draft 자동 생성)는 제거됐다 — 플랜은 ⑤ 가이드 업로드로만 생성(plan-only).
// 급소 2(N5_단독시작문서.md §7): '플랜 만들기' 클릭만으로 빈 draft가 생겨
// 플랜/실적 머지 거부의 근본 원인이었음.

// draft 옵션/아이템 전체 교체 저장 + 라이브 롤업 계산 (confirmed 면 거부)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      plan_id: string;
      options: OptionIn[];
      coupon?: { min_order: number; rate: number; max: number };
    };
    const { plan_id, options } = body;
    const couponSpec =
      body.coupon && body.coupon.rate > 0
        ? {
            min_order_amount: Number(body.coupon.min_order) || 0,
            discount_rate: Number(body.coupon.rate) || 0,
            max_discount_amount: Number(body.coupon.max) || 0,
          }
        : null;
    const supabase = await createClient();

    const { data: plan, error: pErr } = await supabase
      .from("campaign_plans")
      .select("id, status")
      .eq("id", plan_id)
      .eq("promotion_id", id)
      .single();
    if (pErr || !plan)
      return NextResponse.json({ error: "플랜을 찾을 수 없습니다" }, { status: 404 });
    if (plan.status === "confirmed")
      return NextResponse.json(
        { error: "확정된 플랜은 수정할 수 없습니다. '수정(새 버전)'으로 새 draft를 만드세요." },
        { status: 409 },
      );

    // 라이브 단가/원가: rate card current + products
    const { data: rc } = await supabase
      .from("rate_card")
      .select("fee_rate, ad_rate, logistics_rate, reward_rate")
      .eq("is_current", true)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    // 채널 수수료 override (없으면 레이트카드 fee)
    const { data: promoRow } = await supabase
      .from("promotions")
      .select("channel")
      .eq("id", id)
      .maybeSingle();
    let channelFee: number | null = null;
    if (promoRow?.channel) {
      const { data: cf } = await supabase
        .from("channel_fees")
        .select("fee_rate")
        .eq("channel", promoRow.channel as string)
        .maybeSingle();
      channelFee = (cf?.fee_rate as number | undefined) ?? null;
    }
    const mult = rc ? effectiveMult(rc, channelFee) : 0.715;

    const productIds = [
      ...new Set(options.flatMap((o) => o.items.map((it) => it.product_id))),
    ];
    const priceMap = new Map<
      string,
      { consumer_price: number | null; regular_price: number | null; cost: number | null }
    >();
    if (productIds.length > 0) {
      const { data: prods, error: prErr } = await supabase
        .from("products")
        .select("id, consumer_price, regular_price, cost")
        .in("id", productIds);
      if (prErr) throw prErr;
      for (const p of prods ?? [])
        priceMap.set(p.id as string, {
          consumer_price: p.consumer_price as number | null,
          regular_price: p.regular_price as number | null,
          cost: p.cost as number | null,
        });
    }

    // 전체 교체: 기존 옵션 삭제(아이템 cascade)
    const { error: delErr } = await supabase
      .from("campaign_plan_options")
      .delete()
      .eq("campaign_plan_id", plan_id);
    if (delErr) throw delErr;

    let revTotal = 0;
    let contribTotal = 0;
    for (const [idx, opt] of options.entries()) {
      const itemInputs: PlanItemInput[] = opt.items.map((it) => {
        const pm = priceMap.get(it.product_id);
        return {
          sku_qty_per_option: it.sku_qty_per_option,
          unit_sale_price: it.unit_sale_price,
          consumer_price: pm?.consumer_price ?? null,
          regular_price: pm?.regular_price ?? null,
          cost: pm?.cost ?? null,
        };
      });
      const t = computeOptionTotals(itemInputs, mult, opt.expected_option_qty, couponSpec);
      revTotal += t.expected_revenue;
      contribTotal += t.expected_contribution;

      // 옵션 매칭 패턴 기본값: 빈 배열이면 옵션 라벨을 자동 매칭 후보로.
      // (DB plan_vs_actual_options: 공백제거 lowercase 부분일치)
      const defaultPatterns =
        opt.match_patterns && opt.match_patterns.length > 0
          ? opt.match_patterns
          : opt.option_label
            ? [opt.option_label]
            : [];
      const { data: newOpt, error: oErr } = await supabase
        .from("campaign_plan_options")
        .insert({
          campaign_plan_id: plan_id,
          option_label: opt.option_label,
          expected_option_qty: opt.expected_option_qty,
          is_main: !!opt.is_main,
          match_patterns: defaultPatterns,
          sort: opt.sort ?? idx,
          set_price: t.set_price,
          consumer_total: t.consumer_total,
          regular_total: t.regular_total,
          discount_rate_consumer: t.discount_rate_consumer,
          discount_rate_regular: t.discount_rate_regular,
          expected_revenue: t.expected_revenue,
          expected_contribution: t.expected_contribution,
        })
        .select("id")
        .single();
      if (oErr) throw oErr;

      if (opt.items.length > 0) {
        const { error: iErr } = await supabase
          .from("campaign_plan_option_items")
          .insert(
            opt.items.map((it, i) => ({
              campaign_plan_option_id: newOpt.id,
              product_id: it.product_id,
              base_name: it.base_name,
              sku_qty_per_option: it.sku_qty_per_option,
              unit_sale_price: it.unit_sale_price,
              source_config_id: it.source_config_id ?? null,
              sort: i,
            })),
          );
        if (iErr) throw iErr;
      }
    }

    // 메인 상품 = 메인 옵션(is_main)의 SKU들 — 플랜에서 나눈 메인/서브를 성과 측정에 직접 연결.
    // (별도 '메타/메인 편집' 없이 플랜이 단일 출처). 메인 옵션이 없으면 null = 전체 메인.
    const mainIds = [
      ...new Set(
        options.filter((o) => o.is_main).flatMap((o) => o.items.map((it) => it.product_id)),
      ),
    ];

    const { error: upErr } = await supabase
      .from("campaign_plans")
      .update({
        expected_revenue_total: revTotal,
        expected_contribution_total: contribTotal,
        coupon_min_order: couponSpec?.min_order_amount ?? 0,
        coupon_rate: couponSpec?.discount_rate ?? 0,
        coupon_max: couponSpec?.max_discount_amount ?? 0,
        main_product_ids: mainIds.length > 0 ? mainIds : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", plan_id);
    if (upErr) throw upErr;

    // 메인 지정이 메인/함께구매 분해에 영향 → 사전계산 롤업 갱신
    await supabase.rpc("refresh_rollups", { p_force: true });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "플랜 저장 실패" },
      { status: 500 },
    );
  }
}
