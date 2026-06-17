import { cn } from "@/lib/cn";
import { TONE_CLASSES, type Tone } from "@/lib/status";

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
  variant?: "soft" | "solid";
};

export function Badge({ className, tone = "neutral", variant = "soft", children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        TONE_CLASSES[tone][variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
