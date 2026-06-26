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

// 품목 마스터(SKU 템플릿)는 이름 접두로 종류를 구분한다.
// 판매: (제품)/(세트)/(상품) · 비판매 구성품: (원재료)/(부재료)/(부자재).
export type ProductKind = "제품" | "세트" | "상품" | "원재료" | "부재료" | "부자재" | "기타";
export const SELLABLE_KINDS: ProductKind[] = ["제품", "세트", "상품"];
export const COMPONENT_KINDS: ProductKind[] = ["원재료", "부재료", "부자재"];

/** 이름 접두로 종류 판별. 접두가 없으면 '기타'. */
export function productKind(name: string | null | undefined): ProductKind {
  if (!name) return "기타";
  const m = name.trimStart().match(/^\(([^)]+)\)/);
  const k = m?.[1]?.trim();
  const all: ProductKind[] = ["제품", "세트", "상품", "원재료", "부재료", "부자재"];
  return (all as string[]).includes(k ?? "") ? (k as ProductKind) : "기타";
}

/** 원재료·부재료·부자재(비판매 구성품)면 true — 판매 SKU 검색에서 제외용. */
export function isComponentName(name: string | null | undefined): boolean {
  return COMPONENT_KINDS.includes(productKind(name));
}

/** 배열을 size 단위로 분할 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
