"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";

// 사이드/바텀 시트 — Radix Dialog 기반(포커스 트랩·Escape·복원). 모바일은 bottom 권장.
export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

const overlayCls =
  "fixed inset-0 z-50 bg-ink/30 " +
  "data-[state=open]:[animation:ui-overlay-in_var(--duration-fast)_var(--ease-standard)] " +
  "data-[state=closed]:[animation:ui-overlay-out_var(--duration-fast)_var(--ease-exit)]";

const SIDE: Record<"right" | "bottom", string> = {
  right:
    "right-0 top-0 h-full w-[min(420px,calc(100vw-2rem))] border-l rounded-l-2xl " +
    "data-[state=open]:[animation:ui-drawer-in-right_var(--duration-normal)_var(--ease-standard)] " +
    "data-[state=closed]:[animation:ui-drawer-out-right_var(--duration-fast)_var(--ease-exit)]",
  bottom:
    "inset-x-0 bottom-0 max-h-[85vh] w-full border-t rounded-t-2xl " +
    "data-[state=open]:[animation:ui-drawer-in-bottom_var(--duration-normal)_var(--ease-standard)] " +
    "data-[state=closed]:[animation:ui-drawer-out-bottom_var(--duration-fast)_var(--ease-exit)]",
};

export function DrawerContent({
  side = "right",
  className,
  title,
  description,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: "right" | "bottom";
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayCls} />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col border-line bg-card p-5 shadow-[0_12px_40px_rgba(16,24,40,0.16)] focus:outline-none",
          SIDE[side],
          className,
        )}
        {...props}
      >
        <div className="mb-3">
          <DialogPrimitive.Title className="text-base font-semibold text-ink">{title}</DialogPrimitive.Title>
          {description && (
            <DialogPrimitive.Description className="mt-1 text-xs text-ink-3">
              {description}
            </DialogPrimitive.Description>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
