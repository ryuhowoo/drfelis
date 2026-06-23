import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  CampaignPlan,
  CampaignPlanOption,
  CampaignPlanOptionItem,
  RateCard,
} from "@/lib/types";
import PlanEditor, {
  type EditorOption,
  type ProductEcon,
  type QtyHint,
} from "./PlanEditor";

export const dynamic = "force-dynamic";

export default async function PlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: promo } = await supabase
    .from("promotions")
    .select("id, name, start_date, end_date, purposes")
    .eq("id", id)
    .single();
  if (!promo) notFound();

  // 편집 대상 = 최신 버전 플랜
  const { data: plans } = await supabase
    .from("campaign_plans")
    .select("*")
    .eq("promotion_id", id)
    .order("version", { ascending: false });
  const plan = ((plans as CampaignPlan[]) ?? [])[0] ?? null;

  let options: EditorOption[] = [];
  const econ: ProductEcon = {};
  if (plan) {
    const { data: optRows } = await supabase
      .from("campaign_plan_options")
      .select("*")
      .eq("campaign_plan_id", plan.id)
      .order("sort");
    const opts = (optRows as CampaignPlanOption[]) ?? [];
    const optIds = opts.map((o) => o.id);
    let items: CampaignPlanOptionItem[] = [];
    if (optIds.length > 0) {
      const { data: itemRows } = await supabase
        .from("campaign_plan_option_items")
        .select("*")
        .in("campaign_plan_option_id", optIds)
        .order("sort");
      items = (itemRows as CampaignPlanOptionItem[]) ?? [];
    }
    // draft는 frozen_*가 비어있으므로 products 라이브 경제값을 곁들여 전달
    const productIds = [...new Set(items.map((it) => it.product_id))];
    if (productIds.length > 0) {
      const { data: prods } = await supabase
        .from("products")
        .select("id, consumer_price, regular_price, cost")
        .in("id", productIds);
      for (const p of prods ?? [])
        econ[p.id as string] = {
          consumer_price: p.consumer_price as number | null,
          regular_price: p.regular_price as number | null,
          cost: p.cost as number | null,
        };
    }
    options = opts.map((o) => ({
      option_label: o.option_label,
      expected_option_qty: o.expected_option_qty,
      is_main: o.is_main,
      match_patterns: o.match_patterns ?? [],
      // confirmed 표시용 동결 롤업
      frozen: {
        set_price: o.set_price,
        discount_rate_consumer: o.discount_rate_consumer,
        discount_rate_regular: o.discount_rate_regular,
        expected_revenue: o.expected_revenue,
        expected_contribution: o.expected_contribution,
      },
      items: items
        .filter((it) => it.campaign_plan_option_id === o.id)
        .map((it) => ({
          product_id: it.product_id,
          base_name: it.base_name,
          sku_qty_per_option: it.sku_qty_per_option,
          unit_sale_price: it.unit_sale_price,
          source_config_id: it.source_config_id,
          // confirmed면 frozen_*, draft면 products 라이브
          consumer_price:
            it.frozen_consumer_price ?? econ[it.product_id]?.consumer_price ?? null,
          regular_price:
            it.frozen_regular_price ?? econ[it.product_id]?.regular_price ?? null,
          cost: it.frozen_cost ?? econ[it.product_id]?.cost ?? null,
        })),
    }));
  }

  const { data: rc } = await supabase
    .from("rate_card")
    .select("*")
    .eq("is_current", true)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 예상 세트수 힌트 (S6.2): 다른 캠페인 확정 플랜 옵션의 예상 세트수 평균 (비구속)
  let qtyHint: QtyHint = { main: null, sub: null, mainN: 0, subN: 0 };
  const { data: confPlans } = await supabase
    .from("campaign_plans")
    .select("id")
    .eq("status", "confirmed")
    .neq("promotion_id", id);
  const confIds = ((confPlans as { id: string }[]) ?? []).map((p) => p.id);
  if (confIds.length > 0) {
    const { data: hintOpts } = await supabase
      .from("campaign_plan_options")
      .select("expected_option_qty, is_main")
      .in("campaign_plan_id", confIds);
    const hintRows =
      (hintOpts as { expected_option_qty: number | null; is_main: boolean }[]) ?? [];
    const avgQty = (pred: (r: (typeof hintRows)[number]) => boolean) => {
      const xs = hintRows
        .filter(pred)
        .map((r) => r.expected_option_qty)
        .filter((x): x is number => x != null && x > 0);
      return xs.length
        ? { v: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), n: xs.length }
        : { v: null, n: 0 };
    };
    const m = avgQty((r) => r.is_main);
    const s = avgQty((r) => !r.is_main);
    qtyHint = { main: m.v, sub: s.v, mainN: m.n, subN: s.n };
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <div className="mb-1 text-sm text-neutral-400">
        <Link href="/" className="hover:underline">
          대시보드
        </Link>{" "}
        /{" "}
        <Link href={`/promotions/${id}`} className="hover:underline">
          캠페인
        </Link>{" "}
        / 가격 가이드(플랜)
      </div>
      <h1 className="text-xl font-semibold">{promo.name} — 가격 가이드(플랜)</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {promo.start_date} ~ {promo.end_date}
      </p>

      <PlanEditor
        promotionId={id}
        plan={plan}
        initialOptions={options}
        rateCard={(rc as RateCard) ?? null}
        qtyHint={qtyHint}
        purposes={(promo.purposes as string[] | null) ?? []}
        campaignName={promo.name as string}
        startDate={promo.start_date as string}
        endDate={promo.end_date as string}
      />
    </div>
  );
}
