import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Promotion,
  PromotionSummary,
  MeasurementRow,
  CampaignAchievement,
} from "./types";
import type { CaseFeature } from "./predict";
import { daysBetween } from "./format";

// 달성 신뢰도(S6): 확정 플랜 + 계획 정확도(|1−ach_revenue|)를 0~1로.
// 확정·근접 달성↑, 플랜 없거나 실적 없으면 기본값 0.5.
function reliabilityFrom(a: CampaignAchievement | null): number {
  if (!a || !a.has_confirmed_plan || a.ach_revenue == null) return 0.5;
  const accuracy = Math.max(0, 1 - Math.abs(1 - a.ach_revenue));
  return 0.5 + 0.5 * accuracy;
}

/** 모든 프로모션 + 요약/측정을 CaseFeature 배열로 로드 */
export async function loadCases(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<CaseFeature[]> {
  const [{ data: promos }, { data: achData }] = await Promise.all([
    supabase.from("promotions").select("*"),
    supabase.rpc("campaign_achievements"),
  ]);
  if (!promos) return [];
  const achMap = new Map<string, CampaignAchievement>(
    ((achData as CampaignAchievement[]) ?? []).map((a) => [a.promotion_id, a]),
  );

  return Promise.all(
    (promos as Promotion[]).map(async (p) => {
      const [{ data: sData }, { data: mData }, { data: psData }, { data: ewData }] =
        await Promise.all([
          supabase.rpc("promotion_summary", { p_id: p.id }),
          supabase.rpc("promotion_measurement", { p_id: p.id }),
          supabase
            .from("promotion_sales")
            .select("quantity, order_count")
            .eq("promotion_id", p.id),
          supabase.rpc("effective_purpose_weights", { p_id: p.id }),
        ]);
      const s = (sData?.[0] as PromotionSummary) ?? null;
      const meas = (mData as MeasurementRow[]) ?? [];
      const ps = (psData as { quantity: number; order_count: number }[]) ?? [];
      const purposes = ((ewData as { purpose: string; weight: number }[]) ?? []).map(
        (w) => ({ purpose: w.purpose, weight: Number(w.weight) }),
      );
      const a = achMap.get(p.id) ?? null;
      const duration = daysBetween(p.start_date, p.end_date);
      const promoDays = meas[0]?.promo_days ?? duration;
      const baseline_daily = meas.reduce((a, x) => a + x.baseline_daily_revenue, 0);
      const actual_daily =
        promoDays > 0 ? meas.reduce((a, x) => a + x.actual_revenue, 0) / promoDays : 0;
      const totalQty = ps.reduce((a, x) => a + (x.quantity ?? 0), 0);
      const totalOrders = ps.reduce((a, x) => a + (x.order_count ?? 0), 0);
      return {
        id: p.id,
        name: p.name,
        start_date: p.start_date,
        end_date: p.end_date,
        promo_type: p.promo_type,
        season_tag: p.season_tag,
        discount_rate: p.benefits?.discount_rate ?? null,
        duration_days: duration,
        uplift_per_day: s && duration > 0 ? s.total_uplift / duration : 0,
        total_uplift: s?.total_uplift ?? 0,
        contribution: s?.contribution ?? 0,
        contribution_rate: s?.contribution_rate ?? null,
        halo_share: s?.halo_share ?? null,
        baseline_daily,
        actual_daily,
        qty_per_day: promoDays > 0 ? totalQty / promoDays : 0,
        orders_per_day: promoDays > 0 ? totalOrders / promoDays : 0,
        purposes,
        ach_revenue: a?.ach_revenue ?? null,
        ach_contribution: a?.ach_contribution ?? null,
        has_confirmed_plan: a?.has_confirmed_plan ?? false,
        reliability: reliabilityFrom(a),
      };
    }),
  );
}
