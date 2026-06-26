import { createClient } from "@/lib/supabase/server";
import ProductsTable, { type ProductRow } from "./ProductsTable";

export const dynamic = "force-dynamic";

// 상품·가격 가이드 — 웹이 단일 출처. SKU 코드·원가·판매가를 직접 추가/수정/삭제.
export default async function ProductsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("id, base_name, dr_code, category, cost, consumer_price, regular_price, is_subscription")
    .order("dr_code", { ascending: true, nullsFirst: false })
    .order("base_name", { ascending: true });
  const rows = ((data as ProductRow[]) ?? []);
  const categories = [...new Set(rows.map((r) => r.category).filter((c): c is string => !!c))].sort();

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <h1 className="text-xl font-semibold tracking-tight">상품 · 가격 가이드</h1>
      <p className="mt-1 text-sm text-ink-3">
        SKU 코드 · 원가 · 소비자가 · 상시 판매가를 <strong>웹에서 직접</strong> 관리합니다(단일 출처).
        시트는 ‘데이터 업로드’에서 <strong>수동 가져오기</strong>로만 사용해요. 묶음·정기 가격은 각 행의 ‘가격 구성’에서(다음 단계).
      </p>
      <ProductsTable initialRows={rows} categories={categories} />
    </div>
  );
}
