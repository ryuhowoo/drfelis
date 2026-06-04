import type { SupabaseClient } from "@supabase/supabase-js";
import { PROMO_TYPES, SEASON_TAGS, PURPOSE_TAGS } from "./constants";

export type Options = {
  benefitTypes: string[];
  seasonalities: string[];
  purposes: string[];
};

/**
 * 혜택종류·시즈널리티·목적 목록을 DB에서 로드.
 * 테이블 미존재/비어있으면 기본 상수로 폴백 — 마이그레이션 적용 전에도 안전.
 */
export async function loadOptions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<Options> {
  const [bt, ss, pp] = await Promise.all([
    supabase.from("benefit_types").select("name").order("sort"),
    supabase.from("seasonalities").select("name").order("sort"),
    supabase.from("purposes").select("name").order("sort"),
  ]);
  const benefitTypes =
    !bt.error && bt.data && bt.data.length > 0
      ? bt.data.map((r) => r.name as string)
      : PROMO_TYPES;
  const seasonalities =
    !ss.error && ss.data && ss.data.length > 0
      ? ss.data.map((r) => r.name as string)
      : SEASON_TAGS;
  const purposes =
    !pp.error && pp.data && pp.data.length > 0
      ? pp.data.map((r) => r.name as string)
      : PURPOSE_TAGS;
  return { benefitTypes, seasonalities, purposes };
}
