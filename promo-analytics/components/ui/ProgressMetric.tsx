import { cn } from "@/lib/cn";

// 달성 KPI — 진행바 + 값/목표 + 부족·초과 + 일관된 캡션. (지시서 P0-3)
export function ProgressMetric({
  label,
  ratio,
  valueLabel,
  targetLabel,
  caption,
  delta,
  note,
  action,
  primary,
}: {
  label: string;
  ratio: number | null; // 0..n (1=100%)
  valueLabel: string;
  targetLabel: string;
  caption?: string;
  delta?: string; // 부족/초과 설명
  note?: string; // 경고 안내 (예: 계산 불가)
  action?: React.ReactNode;
  primary?: boolean;
}) {
  const over = ratio != null && ratio >= 1;
  const fill = ratio == null ? 0 : Math.min(100, Math.max(0, ratio * 100));
  const pctText = ratio == null ? "—" : `${Math.round(ratio * 100)}%`;
  return (
    <div className={cn("rounded-2xl p-4", primary ? "bg-brand-50" : "card-soft")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-ink-3">{label}</span>
        {delta && <span className="text-[11px] text-ink-4">{delta}</span>}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={cn("text-2xl font-semibold tabular-nums", note && ratio == null && "text-warning")}>
          {note && ratio == null ? "계산 불가" : pctText}
        </span>
        <span className="text-xs text-ink-4">
          {valueLabel} <span className="text-ink-4/70">/ {targetLabel}</span>
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-soft">
        <div
          className={cn(
            "h-full rounded-full [transition:width_var(--duration-slow)_var(--ease-standard)]",
            over ? "bg-success" : ratio == null ? "bg-transparent" : "bg-brand-400",
          )}
          style={{ width: `${fill}%` }}
        />
      </div>
      {caption && <div className="mt-1.5 text-[10px] leading-tight text-ink-4">{caption}</div>}
      {note && <div className="mt-1 text-[10px] leading-tight text-warning">{note}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
