"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";

// Radix 기반 — 포커스 트랩·Escape·열린 후 포커스 이동·닫힌 후 트리거 복원·aria-modal 자동.
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const overlayCls =
  "fixed inset-0 z-50 bg-ink/30 backdrop-blur-[1px] " +
  "data-[state=open]:[animation:ui-overlay-in_var(--duration-fast)_var(--ease-standard)] " +
  "data-[state=closed]:[animation:ui-overlay-out_var(--duration-fast)_var(--ease-exit)]";

const contentCls =
  "fixed left-1/2 top-1/2 z-50 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 " +
  "rounded-2xl border border-line bg-card p-5 shadow-[0_12px_40px_rgba(16,24,40,0.16)] " +
  "focus:outline-none " +
  "data-[state=open]:[animation:ui-dialog-in_var(--duration-normal)_var(--ease-emphasized)] " +
  "data-[state=closed]:[animation:ui-dialog-out_var(--duration-fast)_var(--ease-exit)]";

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayCls} />
      <DialogPrimitive.Content className={cn(contentCls, className)} {...props}>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({
  title,
  description,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <DialogPrimitive.Title className="text-base font-semibold text-ink">{title}</DialogPrimitive.Title>
      {description && (
        <DialogPrimitive.Description className="mt-1 text-xs text-ink-3">
          {description}
        </DialogPrimitive.Description>
      )}
    </div>
  );
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-5 flex items-center justify-end gap-2", className)} {...props} />;
}
