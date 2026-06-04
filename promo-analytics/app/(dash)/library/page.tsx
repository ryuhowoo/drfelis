import { createClient } from "@/lib/supabase/server";
import type { Promotion, PromotionSummary } from "@/lib/types";
import LibraryTable, { type LibraryRow } from "./LibraryTable";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const supabase = await createClient();
  const { data: promos } = await supabase
    .from("promotions")
    .select("*")
    .order("start_date", { ascending: false });

  const rows: LibraryRow[] = await Promise.all(
    (promos ?? []).map(async (p: Promotion) => {
      const { data } = await supabase.rpc("promotion_summary", { p_id: p.id });
      const s = (data?.[0] as PromotionSummary) ?? null;
      return {
        id: p.id,
        name: p.name,
        start_date: p.start_date,
        end_date: p.end_date,
        promo_type: p.promo_type,
        season_tag: p.season_tag,
        purpose: p.purpose,
        discount_rate: p.benefits?.discount_rate ?? null,
        total_uplift: s?.total_uplift ?? 0,
        halo_share: s?.halo_share ?? null,
        contribution: s?.contribution ?? 0,
        uplift_per_day:
          s && s.promo_days > 0 ? s.total_uplift / s.promo_days : 0,
      };
    }),
  );

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <h1 className="text-xl font-semibold">히스토리 비교/분석</h1>
      <p className="mt-1 text-sm text-neutral-500">
        과거 캠페인을 유형·시즈널리티·성과 기준으로 비교·분석하세요.
      </p>
      <div className="mt-6">
        <LibraryTable data={rows} />
      </div>
    </div>
  );
}
