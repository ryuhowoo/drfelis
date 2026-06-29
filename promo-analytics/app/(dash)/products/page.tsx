import { createClient } from "@/lib/supabase/server";
import ProductsTable, { type ProductRow, type ConfigLite } from "./ProductsTable";

export const dynamic = "force-dynamic";

// 상품·가격 가이드 — 웹이 단일 출처. 기본정보·카테고리·브랜드·원가·상시/정기/묶음 가격을 직접 관리.
export default async function ProductsPage() {
  const supabase = await createClient();
  const [{ data: prod }, { data: cats }, { data: brs }, { data: cfgs }, { data: rc }] = await Promise.all([
    supabase
      .from("products")
      .select("id, base_name, dr_code, category, brand, channel, status, cost, consumer_price, regular_price, is_subscription")
      .order("dr_code", { ascending: true, nullsFirst: false })
      .order("base_name", { ascending: true }),
    supabase.from("product_categories").select("name, sort").order("sort"),
    supabase.from("product_brands").select("name, sort").order("sort"),
    supabase.from("product_price_configs").select("product_id, sale_mode, config_type, sale_price, free_shipping"),
    supabase
      .from("rate_card")
      .select("fee_rate, ad_rate, logistics_rate, reward_rate")
      .eq("is_current", true)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const unsorted = (prod as ProductRow[]) ?? [];
  const managed = (cats ?? []).map((c) => c.name as string);
  const fromProducts = [...new Set(unsorted.map((r) => r.category).filter((c): c is string => !!c))];
  const categories = [...new Set([...managed, ...fromProducts])];
  // 서브 브랜드 중요도 순(시트와 동일) → 같은 브랜드 안에서는 품목코드 순. 브랜드 없으면 맨 뒤.
  const brandOrder = new Map<string, number>((brs ?? []).map((b) => [b.name as string, b.sort as number]));
  const brands = [
    ...(brs ?? []).map((b) => b.name as string),
    ...[...new Set(unsorted.map((r) => r.brand).filter((b): b is string => !!b))].filter((b) => !brandOrder.has(b)),
  ];
  const rows = [...unsorted].sort((a, b) => {
    const ba = a.brand ? brandOrder.get(a.brand) ?? 900 : 999;
    const bb = b.brand ? brandOrder.get(b.brand) ?? 900 : 999;
    if (ba !== bb) return ba - bb;
    return (a.dr_code ?? "￿").localeCompare(b.dr_code ?? "￿");
  });
  const channels = [...new Set(unsorted.map((r) => r.channel).filter(Boolean))].sort();

  const configsByProduct: Record<string, ConfigLite[]> = {};
  for (const c of (cfgs as (ConfigLite & { product_id: string })[]) ?? []) {
    (configsByProduct[c.product_id] ??= []).push({
      sale_mode: c.sale_mode,
      config_type: c.config_type,
      sale_price: c.sale_price,
      free_shipping: c.free_shipping,
    });
  }
  const mult = rc ? 1 - (Number(rc.fee_rate) + Number(rc.ad_rate) + Number(rc.logistics_rate) + Number(rc.reward_rate)) : 0.715;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <h1 className="text-xl font-semibold tracking-tight">상품 · 가격 가이드</h1>
      <p className="mt-1 text-sm text-ink-3">
        SKU 코드·카테고리·브랜드·원가·소비자가·상시/정기/묶음 가격을 <strong>웹에서 직접</strong> 관리합니다(단일 출처).
        가격만 입력하면 할인율·마진율·공헌이익은 자동 계산돼요. ‘가격표’ 보기로 시트형 매트릭스를 볼 수 있습니다.
      </p>
      <ProductsTable
        initialRows={rows}
        categories={categories}
        brands={brands}
        channels={channels}
        configsByProduct={configsByProduct}
        mult={mult}
      />
    </div>
  );
}
