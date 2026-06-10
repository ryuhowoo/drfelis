import { createClient } from "@/lib/supabase/server";
import type {
  Promotion,
  PromotionSummary,
  CampaignAchievement,
  CampaignFit,
} from "@/lib/types";
import LibraryTable, { type LibraryRow } from "./LibraryTable";
import LibraryCompare, { type CompareCampaign } from "./LibraryCompare";

export const dynamic = "force-dynamic";

// 0022 롤업 번들 — 사전 계산된 서빙 테이블에서 1회 왕복으로 읽는다
type RollupEntry = {
  promotion_id: string;
  features: (PromotionSummary & { promotion_id: string }) | null;
  achievement: CampaignAchievement | null;
  fits: CampaignFit[];
  daily: { d: string; rev: number; in: boolean }[];
};
type LibraryBundle = { promotions: Promotion[]; rollups: RollupEntry[] };

export default async function LibraryPage() {
  const supabase = await createClient();
  const { data: bundle } = await supabase.rpc("library_bundle");
  const { promotions: promos = [], rollups = [] } =
    ((bundle as LibraryBundle | null) ?? {}) as Partial<LibraryBundle>;

  const sumMap = new Map<string, PromotionSummary>();
  const achMap = new Map<string, CampaignAchievement>();
  const fitMap = new Map<
    string,
    { purpose: string; score: number | null; reliable: boolean }[]
  >();
  for (const r of rollups) {
    if (r.features) sumMap.set(r.promotion_id, r.features);
    if (r.achievement) achMap.set(r.promotion_id, r.achievement);
    fitMap.set(
      r.promotion_id,
      (r.fits ?? []).map((f) => ({
        purpose: f.purpose,
        score: f.fit_score_0_100 != null ? Number(f.fit_score_0_100) : null,
        reliable: f.data_reliable,
      })),
    );
  }

  // 비교 오버레이용: 일별 시리즈 보유 캠페인 (이름은 promotions 기준)
  const dailyMap = new Map(rollups.map((r) => [r.promotion_id, r.daily ?? []]));
  const compareCampaigns: CompareCampaign[] = (promos ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    daily: dailyMap.get(p.id) ?? [],
  }));

  const rows: LibraryRow[] = (promos ?? []).map((p: Promotion) => {
    const s = sumMap.get(p.id) ?? null;
    const a = achMap.get(p.id) ?? null;
    return {
      id: p.id,
      name: p.name,
      start_date: p.start_date,
      end_date: p.end_date,
      promo_type: p.promo_type,
      season_tag: p.season_tag,
      purpose: p.purpose,
      discount_rate: p.benefits?.discount_rate ?? null,
      total_uplift: Number(s?.total_uplift) || 0,
      halo_share: s?.halo_share != null ? Number(s.halo_share) : null,
      contribution: Number(s?.contribution) || 0,
      uplift_per_day:
        s && Number(s.promo_days) > 0
          ? Number(s.total_uplift) / Number(s.promo_days)
          : 0,
      has_confirmed_plan: a?.has_confirmed_plan ?? false,
      ach_revenue: a?.ach_revenue ?? null,
      ach_contribution: a?.ach_contribution ?? null,
      quantity_reliable: a?.quantity_reliable ?? null,
      fits: fitMap.get(p.id) ?? [],
    };
  });

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <h1 className="text-xl font-semibold">히스토리 비교/분석</h1>
      <p className="mt-1 text-sm text-neutral-500">
        과거 캠페인을 유형·시즈널리티·성과 기준으로 비교·분석하세요.
      </p>
      <LibraryCompare campaigns={compareCampaigns} />
      <div className="mt-6">
        <LibraryTable data={rows} />
      </div>
    </div>
  );
}
