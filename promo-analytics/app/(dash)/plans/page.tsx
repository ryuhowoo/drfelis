import { createClient } from "@/lib/supabase/server";
import PlansBoard, { type PlanRow, type PlanOption } from "./PlansBoard";

export const dynamic = "force-dynamic";

type PlansBundle = { plans: PlanRow[]; options: PlanOption[] };

export default async function PlansPage() {
  const supabase = await createClient();
  const { data: bundle } = await supabase.rpc("plans_bundle");
  const { plans = [], options = [] } =
    ((bundle as PlansBundle | null) ?? {}) as Partial<PlansBundle>;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <h1 className="text-xl font-semibold">플랜 보드</h1>
      <p className="mt-1 text-sm text-neutral-500">
        실적과 분리된 캠페인 플랜 전체를 모아 보고, 우리 팀의 계획 성향을 분석합니다.
        플랜은 ⑤ 가이드 시트 업로드로 쌓입니다.
      </p>
      <div className="mt-6">
        <PlansBoard plans={plans} options={options} />
      </div>
    </div>
  );
}
