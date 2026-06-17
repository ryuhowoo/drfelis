import { cn } from "@/lib/cn";

// 빈/오류 상태 — 테이블·리스트·차트에서 일관 사용.
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-soft/40 px-6 py-10 text-center",
        className,
      )}
    >
      <div className="text-sm font-medium text-ink-2">{title}</div>
      {description && <div className="max-w-sm text-xs text-ink-4">{description}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
