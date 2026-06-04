import type { SupabaseClient } from "@supabase/supabase-js";
import type { Promotion, PromotionSummary, MeasurementRow } from "./types";
import type { CaseFeature } from "./predict";
import { daysBetween } from "./format";

/** 모든 프로모션 + 요약/측정을 CaseFeature 배열로 로드 */
export async function loadCases(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<CaseFeature[]> {
  const { data: promos } = await supabase.from("promotions").select("*");
  if (!promos) return [];

  return Promise.all(
    (promos as Promotion[]).map(async (p) => {
      const [{ data: sData }, { data: mData }, { data: psData }] = await Promise.all([
        supabase.rpc("promotion_summary", { p_id: p.id }),
        supabase.rpc("promotion_measurement", { p_id: p.id }),
        supabase
          .from("promotion_sales")
          .select("quantity, order_count")
          .eq("promotion_id", p.id),
      ]);
      const s = (sData?.[0] as PromotionSummary) ?? null;
      const meas = (mData as MeasurementRow[]) ?? [];
      const ps = (psData as { quantity: number; order_count: number }[]) ?? [];
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
      };
    }),
  );
}
