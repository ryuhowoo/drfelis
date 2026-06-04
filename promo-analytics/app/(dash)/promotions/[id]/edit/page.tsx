import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Promotion } from "@/lib/types";
import EditForm from "./EditForm";
import { loadOptions } from "@/lib/options";

export const dynamic = "force-dynamic";

export default async function EditPromotion({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: promo } = await supabase
    .from("promotions")
    .select("*")
    .eq("id", id)
    .single<Promotion>();
  if (!promo) notFound();

  const { data: sales } = await supabase
    .from("promotion_sales")
    .select("product_id, base_name, revenue")
    .eq("promotion_id", id);

  const { data: mains } = await supabase
    .from("promotion_main_products")
    .select("product_id")
    .eq("promotion_id", id);

  // 프로모션 내 상품 목록 (매출 합으로 정렬, 중복 제거)
  const agg = new Map<string, { product_id: string; base_name: string; revenue: number }>();
  for (const s of sales ?? []) {
    if (!s.product_id) continue;
    const cur = agg.get(s.product_id);
    if (cur) cur.revenue += s.revenue ?? 0;
    else
      agg.set(s.product_id, {
        product_id: s.product_id,
        base_name: s.base_name,
        revenue: s.revenue ?? 0,
      });
  }
  const products = [...agg.values()].sort((a, b) => b.revenue - a.revenue);
  const mainIds = (mains ?? []).map((m) => m.product_id);
  const options = await loadOptions(supabase);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <EditForm
        promo={promo}
        products={products}
        initialMainIds={mainIds}
        options={options}
      />
    </div>
  );
}
