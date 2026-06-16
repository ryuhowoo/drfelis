import { cn } from "@/lib/cn";
import { TONE_CLASSES, type Tone } from "@/lib/status";

const GLYPH: Record<Tone, string> = {
  success: "✓",
  warning: "⚠",
  danger: "✕",
  info: "ℹ",
  subscription: "◆",
  brand: "●",
  neutral: "•",
};

// 화면 내 인라인 경고/안내 — toast만으로 중요한 오류를 전달하지 않도록 (접근성 §11).
export function InlineAlert({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: Tone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const isError = tone === "danger";
  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs",
        TONE_CLASSES[tone].soft,
        "border-transparent",
        className,
      )}
    >
      <span aria-hidden className="mt-px text-[11px] leading-none">
        {GLYPH[tone]}
      </span>
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title ? "mt-0.5" : "", "text-ink-2")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
