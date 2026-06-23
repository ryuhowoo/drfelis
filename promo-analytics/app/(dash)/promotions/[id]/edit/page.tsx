import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Promotion } from "@/lib/types";
import EditForm from "./EditForm";
import MergeForm from "./MergeForm";
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

  // 병합 후보 목록 (자기 자신 제외)
  const { data: otherPromos } = await supabase
    .from("promotions")
    .select("id, name, code, start_date, end_date")
    .neq("id", id)
    .order("start_date", { ascending: false });

  const options = await loadOptions(supabase);

  // 목적 가중치 (S5) — 저장된 값 로드
  const { data: weightRows } = await supabase
    .from("promotion_purpose_weights")
    .select("purpose, weight")
    .eq("promotion_id", id);
  const initialWeights: Record<string, number> = {};
  for (const w of weightRows ?? [])
    initialWeights[w.purpose as string] = Number(w.weight);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <EditForm
        promo={promo}
        options={options}
        initialWeights={initialWeights}
      />
      <div className="mt-8">
        <MergeForm
          sourceId={id}
          sourceName={promo.name}
          candidates={
            (otherPromos ?? []).map((p) => ({
              id: p.id as string,
              name: p.name as string,
              code: (p.code as string | null) ?? null,
              start_date: p.start_date as string,
              end_date: p.end_date as string,
            }))
          }
        />
      </div>
    </div>
  );
}
