import { Badge } from "./Badge";
import type { Tone } from "@/lib/status";

// 색상만으로 상태를 전달하지 않도록 톤별 비색 글리프 + 라벨 동반 (접근성 §11).
const GLYPH: Record<Tone, string> = {
  success: "✓",
  warning: "⚠",
  danger: "✕",
  info: "ℹ",
  subscription: "◆",
  brand: "●",
  neutral: "○",
};

export function StatusBadge({
  tone = "neutral",
  label,
  variant = "soft",
  className,
}: {
  tone?: Tone;
  label: string;
  variant?: "soft" | "solid";
  className?: string;
}) {
  return (
    <Badge tone={tone} variant={variant} className={className}>
      <span aria-hidden className="text-[10px] leading-none">
        {GLYPH[tone]}
      </span>
      {label}
    </Badge>
  );
}
