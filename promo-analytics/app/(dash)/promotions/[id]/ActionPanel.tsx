import Link from "next/link";
import { InlineAlert } from "@/components/ui";
import type { ActionItem } from "@/lib/campaign-workflow";

// Layer B — 문제 있는 항목만. 각 조치에 바로가기 CTA.
export function ActionPanel({ actions, basePath }: { actions: ActionItem[]; basePath: string }) {
  if (actions.length === 0) {
    return (
      <InlineAlert tone="success" title="지금 필요한 조치가 없습니다">
        달성 결과를 검토하고 회고를 남겨보세요.
      </InlineAlert>
    );
  }
  return (
    <div className="space-y-2">
      {actions.map((a) => {
        const base = a.href ?? (a.view ? `${basePath}?view=${a.view}` : undefined);
        const href = base ? `${base}${a.hash ? `#${a.hash}` : ""}` : undefined;
        return (
          <InlineAlert
            key={a.id}
            tone={a.tone}
            title={a.title}
            action={
              a.actionLabel && href ? (
                <Link
                  href={href}
                  scroll={!a.hash ? false : undefined}
                  className="rounded-lg bg-card/70 px-2.5 py-1 text-[11px] font-semibold text-ink-2 hover:bg-card focus-visible:outline-none"
                >
                  {a.actionLabel} →
                </Link>
              ) : undefined
            }
          >
            {a.body}
          </InlineAlert>
        );
      })}
    </div>
  );
}
