import Link from "next/link";
import { cn } from "@/lib/cn";
import { WORKFLOW_TONE, TONE_CLASSES } from "@/lib/status";
import type { WorkflowStep } from "@/lib/campaign-workflow";

// 생애주기 워크플로 바 — 현재 단계 하나만 강조, 완료=체크, 경고/차단=아이콘+색.
// 클릭 시 해당 상세 탭으로 이동(URL). 모바일은 가로 스크롤.
const GLYPH = {
  complete: "✓",
  current: "●",
  warning: "⚠",
  blocked: "✕",
  pending: "○",
} as const;

export function CampaignWorkflowBar({
  steps,
  basePath,
}: {
  steps: WorkflowStep[];
  basePath: string; // 예: /promotions/[id]
}) {
  return (
    <nav aria-label="캠페인 진행 단계" className="mb-5">
      <ol className="flex items-stretch gap-1 overflow-x-auto rounded-2xl card-soft p-1.5">
        {steps.map((s) => {
          const tone = WORKFLOW_TONE[s.status];
          const active = s.status === "current" || s.status === "warning" || s.status === "blocked";
          const href = s.view ? `${basePath}?view=${s.view}` : undefined;
          const inner = (
            <div
              className={cn(
                "flex min-w-[7.5rem] flex-col gap-0.5 rounded-xl px-3 py-2 transition-colors",
                "[transition-duration:var(--duration-fast)]",
                active ? TONE_CLASSES[tone].soft : "text-ink-4 hover:bg-soft",
              )}
              aria-current={s.status === "current" ? "step" : undefined}
            >
              <div className="flex items-center gap-1.5">
                <span aria-hidden className={cn("text-[11px] leading-none", active ? "" : "text-ink-4")}>
                  {GLYPH[s.status]}
                </span>
                <span className={cn("text-xs font-semibold", active ? "" : "text-ink-3")}>{s.label}</span>
              </div>
              {s.description && (active || s.status === "complete") && (
                <span className={cn("truncate text-[10px]", active ? "opacity-90" : "text-ink-4")}>
                  {s.description}
                </span>
              )}
            </div>
          );
          return (
            <li key={s.id} className="shrink-0">
              {href ? (
                <Link href={href} scroll={false} className="block focus-visible:outline-none">
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
