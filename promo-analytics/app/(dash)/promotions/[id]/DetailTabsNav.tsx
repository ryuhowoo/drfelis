import Link from "next/link";
import { cn } from "@/lib/cn";

// 상세 심층분석 탭 — URL(?view=)로 보존, 선택 탭만 서버 렌더(lazy). 네비게이션 기반(공유·뒤로가기 정상).
export type DetailView = "overview" | "skus" | "trend" | "purpose" | "sources";

export const DETAIL_VIEWS: { id: DetailView; label: string }[] = [
  { id: "overview", label: "성과 개요" },
  { id: "skus", label: "SKU·옵션" },
  { id: "trend", label: "매출 흐름" },
  { id: "purpose", label: "목적 분석" },
  { id: "sources", label: "데이터·회고" },
];

export function DetailTabsNav({
  active,
  basePath,
  badges,
}: {
  active: DetailView;
  basePath: string;
  badges?: Partial<Record<DetailView, number>>;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-1 mb-4 bg-canvas/80 px-1 py-2 backdrop-blur">
      <nav aria-label="상세 분석 보기" className="flex items-center gap-1 overflow-x-auto">
        {DETAIL_VIEWS.map((v) => {
          const on = v.id === active;
          const badge = badges?.[v.id];
          return (
            <Link
              key={v.id}
              href={`${basePath}?view=${v.id}`}
              scroll={false}
              aria-current={on ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-sm font-medium transition-colors",
                "[transition-duration:var(--duration-fast)] focus-visible:outline-none",
                on ? "bg-card text-ink shadow-sm card-soft" : "text-ink-3 hover:bg-soft hover:text-ink-2",
              )}
            >
              {v.label}
              {badge ? (
                <span className="rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                  {badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
