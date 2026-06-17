"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";

// Radix Tabs — 키보드(←/→/Home/End) 자동, roving tabindex, aria. URL 동기화는 호출부에서.
export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex items-center gap-1 overflow-x-auto rounded-xl bg-soft p-1 text-xs font-medium",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-ink-3 transition-colors",
        "[transition-duration:var(--duration-fast)] hover:text-ink-2 focus-visible:outline-none",
        "data-[state=active]:bg-card data-[state=active]:text-ink data-[state=active]:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn(
        "focus-visible:outline-none",
        "data-[state=active]:[animation:ui-overlay-in_var(--duration-normal)_var(--ease-standard)]",
        className,
      )}
      {...props}
    />
  );
}
