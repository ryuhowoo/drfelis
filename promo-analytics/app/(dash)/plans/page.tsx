import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PlansBoard, { type PlanRow, type PlanOption } from "./PlansBoard";

export const dynamic = "force-dynamic";

type PlansBundle = { plans: PlanRow[]; options: PlanOption[] };

// 캠페인 허브 — 리스트(플랜 보드) + 새 캠페인 + 히스토리·예측·추천 진입을 한곳에 모음.
const SUB = [
  { href: "/library", label: "히스토리 분석" },
  { href: "/predict", label: "성과 예측" },
  { href: "/prescribe", label: "캠페인 추천" },
];

export default async function PlansPage() {
  const supabase = await createClient();
  const { data: bundle } = await supabase.rpc("plans_bundle");
  const { plans = [], options = [] } =
    ((bundle as PlansBundle | null) ?? {}) as Partial<PlansBundle>;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">캠페인</h1>
          <p className="mt-1 text-sm text-ink-3">
            캠페인 플랜 전체를 모아 보고 계획 성향을 분석합니다. 새 캠페인은 여기서 만듭니다.
          </p>
        </div>
        <Link
          href="/campaigns/new"
          className="shrink-0 rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:bg-brand-600 hover:shadow-float"
        >
          + 새 캠페인
        </Link>
      </div>

      <nav className="mt-4 flex flex-wrap gap-1.5">
        {SUB.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-full border border-line bg-card px-3.5 py-1.5 text-xs font-medium text-ink-3 transition hover:text-ink hover:shadow-soft"
          >
            {s.label} →
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        <PlansBoard plans={plans} options={options} />
      </div>
    </div>
  );
}
