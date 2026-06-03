import type { SupabaseClient } from "@supabase/supabase-js";
import type { Promotion, PromotionSummary } from "./types";
import type { CaseFeature } from "./predict";
import { daysBetween } from "./format";

/** 모든 프로모션 + 요약을 CaseFeature 배열로 로드 */
export async function loadCases(
  supabase: SupabaseClient,
): Promise<CaseFeature[]> {
  const { data: promos } = await supabase.from("promotions").select("*");
  if (!promos) return [];

  return Promise.all(
    (promos as Promotion[]).map(async (p) => {
      const { data } = await supabase.rpc("promotion_summary", { p_id: p.id });
      const s = (data?.[0] as PromotionSummary) ?? null;
      const duration = daysBetween(p.start_date, p.end_date);
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
      };
    }),
  );
}
