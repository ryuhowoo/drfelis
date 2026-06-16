"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/cn";

export const TooltipProvider = TooltipPrimitive.Provider;

// 간단 래퍼 — content를 trigger에 붙임. 키보드 포커스 시에도 표시(Radix 기본).
export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}) {
  if (!content) return <>{children}</>;
  return (
    // 자체 Provider 포함 — 앱 레이아웃 변경 없이 단독 사용 가능.
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className={cn(
              "z-50 max-w-[260px] rounded-lg bg-ink px-2.5 py-1.5 text-[11px] leading-snug text-white shadow-lg",
              "data-[state=delayed-open]:[animation:ui-overlay-in_var(--duration-fast)_var(--ease-standard)]",
              className,
            )}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-ink" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
