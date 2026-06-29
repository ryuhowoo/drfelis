import { createClient } from "@/lib/supabase/server";
import ProductsTable, { type ProductRow } from "./ProductsTable";

export const dynamic = "force-dynamic";

// 상품·가격 가이드 — 웹이 단일 출처. SKU 코드·원가·판매가·카테고리를 직접 추가/수정/삭제.
export default async function ProductsPage() {
  const supabase = await createClient();
  const [{ data: prod }, { data: cats }] = await Promise.all([
    supabase
      .from("products")
      .select("id, base_name, dr_code, category, cost, consumer_price, regular_price, is_subscription")
      .order("dr_code", { ascending: true, nullsFirst: false })
      .order("base_name", { ascending: true }),
    supabase.from("product_categories").select("name, sort").order("sort"),
  ]);
  const rows = (prod as ProductRow[]) ?? [];
  // 관리 목록(있으면) 우선, 없으면 상품에서 distinct 로 보완
  const managed = (cats ?? []).map((c) => c.name as string);
  const fromProducts = [...new Set(rows.map((r) => r.category).filter((c): c is string => !!c))];
  const categories = [...new Set([...managed, ...fromProducts])];

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <h1 className="text-xl font-semibold tracking-tight">상품 · 가격 가이드</h1>
      <p className="mt-1 text-sm text-ink-3">
        SKU 코드 · 원가 · 소비자가 · 상시 판매가 · <strong>카테고리</strong>를 웹에서 직접 관리합니다(단일 출처).
        카테고리는 캠페인 메인 카테고리·서브 수량 예측에 쓰이니 정확히 분류하세요. 묶음·정기 가격은 다음 단계.
      </p>
      <ProductsTable initialRows={rows} categories={categories} />
    </div>
  );
}
