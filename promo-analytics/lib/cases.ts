import type { SupabaseClient } from "@supabase/supabase-js";
import type { Promotion, CampaignAchievement } from "./types";
import type { CaseFeature } from "./predict";
import { daysBetween } from "./format";

// 달성 신뢰도(S6): 확정 플랜 + 계획 정확도(|1−ach_revenue|)를 0~1로.
// 확정·근접 달성↑, 플랜 없거나 실적 없으면 기본값 0.5.
function reliabilityFrom(a: CampaignAchievement | null): number {
  if (!a || !a.has_confirmed_plan || a.ach_revenue == null) return 0.5;
  const accuracy = Math.max(0, 1 - Math.abs(1 - a.ach_revenue));
  return 0.5 + 0.5 * accuracy;
}

// promo.all_campaign_features() 반환 행
type CampaignFeatureRow = {
  promotion_id: string;
  promo_days: number | null;
  total_uplift: number | null;
  contribution: number | null;
  contribution_rate: number | null;
  halo_share: number | null;
  baseline_daily: number | null;
  actual_daily: number | null;
  qty_per_day: number | null;
  orders_per_day: number | null;
  duration_days: number | null;
};

/** 모든 프로모션 + 요약/측정/sales/목적가중을 CaseFeature 배열로 로드 (배치 RPC) */
export async function loadCases(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<CaseFeature[]> {
  const [
    { data: promos },
    { data: featData },
    { data: achData },
    { data: weightData },
  ] = await Promise.all([
    supabase.from("promotions").select("*"),
    supabase.rpc("all_campaign_features"),
    supabase.rpc("campaign_achievements"),
    supabase.rpc("all_effective_purpose_weights"),
  ]);
  if (!promos) return [];

  const featMap = new Map<string, CampaignFeatureRow>(
    ((featData as CampaignFeatureRow[]) ?? []).map((f) => [f.promotion_id, f]),
  );
  const achMap = new Map<string, CampaignAchievement>(
    ((achData as CampaignAchievement[]) ?? []).map((a) => [a.promotion_id, a]),
  );
  const purposesMap = new Map<string, { purpose: string; weight: number }[]>();
  for (const w of ((weightData as
    | { promotion_id: string; purpose: string; weight: number }[]
    | null) ?? [])) {
    const arr = purposesMap.get(w.promotion_id) ?? [];
    arr.push({ purpose: w.purpose, weight: Number(w.weight) });
    purposesMap.set(w.promotion_id, arr);
  }

  return (promos as Promotion[]).map((p) => {
    const f = featMap.get(p.id);
    const a = achMap.get(p.id) ?? null;
    const duration =
      Number(f?.duration_days) || daysBetween(p.start_date, p.end_date);
    const total_uplift = Number(f?.total_uplift) || 0;
    return {
      id: p.id,
      name: p.name,
      start_date: p.start_date,
      end_date: p.end_date,
      promo_type: p.promo_type,
      season_tag: p.season_tag,
      discount_rate: p.benefits?.discount_rate ?? null,
      duration_days: duration,
      uplift_per_day: duration > 0 ? total_uplift / duration : 0,
      total_uplift,
      contribution: Number(f?.contribution) || 0,
      contribution_rate:
        f?.contribution_rate != null ? Number(f.contribution_rate) : null,
      halo_share: f?.halo_share != null ? Number(f.halo_share) : null,
      baseline_daily: Number(f?.baseline_daily) || 0,
      actual_daily: Number(f?.actual_daily) || 0,
      qty_per_day: Number(f?.qty_per_day) || 0,
      orders_per_day: Number(f?.orders_per_day) || 0,
      purposes: purposesMap.get(p.id) ?? [],
      ach_revenue: a?.ach_revenue ?? null,
      ach_contribution: a?.ach_contribution ?? null,
      has_confirmed_plan: a?.has_confirmed_plan ?? false,
      reliability: reliabilityFrom(a),
    };
  });
}
