import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 주어진 기초상품명들이 products에 존재하도록 보장하고
 * base_name → product_id 맵을 반환. (없으면 이름만으로 생성)
 */
export async function ensureProducts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  baseNames: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(baseNames.map((n) => n.trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  // 1) 기존 조회
  const { data: existing, error } = await supabase
    .from("products")
    .select("id, base_name")
    .in("base_name", unique);
  if (error) throw error;
  for (const p of existing ?? []) map.set(p.base_name, p.id);

  // 2) 없는 것 생성
  const missing = unique.filter((n) => !map.has(n));
  if (missing.length > 0) {
    const { data: inserted, error: insErr } = await supabase
      .from("products")
      .insert(missing.map((base_name) => ({ base_name })))
      .select("id, base_name");
    if (insErr) throw insErr;
    for (const p of inserted ?? []) map.set(p.base_name, p.id);
  }
  return map;
}

/** 배열을 size 단위로 분할 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
