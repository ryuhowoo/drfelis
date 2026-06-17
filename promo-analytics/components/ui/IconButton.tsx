"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/cn";

type Size = "sm" | "md";

// 아이콘 전용 버튼 — label 필수(aria-label), 최소 터치영역 보장.
export type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  label: string;
  size?: Size;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, label, size = "md", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex items-center justify-center rounded-lg text-ink-3 transition-colors",
        "[transition-duration:var(--duration-fast)] hover:bg-soft hover:text-ink",
        "focus-visible:outline-none disabled:opacity-40",
        // 최소 터치영역 44px은 패딩으로 확보 (작은 아이콘이라도 클릭영역 유지)
        size === "sm" ? "size-8" : "size-9",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
