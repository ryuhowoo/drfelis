"use client";

import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/cn";

// 단일 선택 세그먼트 — Radix ToggleGroup(단일). 키보드·roving tabindex·aria 처리됨.
export type SegmentOption<T extends string> = { value: T; label: React.ReactNode; badge?: React.ReactNode };

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  className,
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: SegmentOption<T>[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onValueChange(v as T)}
      aria-label={ariaLabel}
      className={cn("inline-flex items-center gap-1 rounded-xl bg-soft p-1 text-xs font-medium", className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-ink-3 transition-colors",
            "[transition-duration:var(--duration-fast)] hover:text-ink-2 focus-visible:outline-none",
            "data-[state=on]:bg-card data-[state=on]:text-ink data-[state=on]:shadow-sm",
          )}
        >
          {o.label}
          {o.badge}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
