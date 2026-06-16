"use client";

import { forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700",
  secondary: "border border-line bg-card text-ink-2 hover:bg-soft",
  ghost: "text-ink-2 hover:bg-soft",
  danger: "bg-danger text-white hover:brightness-95",
  subtle: "bg-soft text-ink-2 hover:bg-line/60",
};
const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-9 px-4 text-sm gap-2 rounded-xl",
  lg: "h-11 px-5 text-sm gap-2 rounded-xl",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  asChild?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading, asChild, disabled, children, ...props },
  ref,
) {
  const classes = cn(
    "inline-flex items-center justify-center font-semibold transition-colors",
    "[transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
    "focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );

  // asChild는 단일 자식만 허용(Radix Slot) — 스피너 주입/래핑 없이 자식 그대로 전달.
  if (asChild) {
    return (
      <Slot
        ref={ref}
        aria-disabled={disabled || loading || undefined}
        className={classes}
        {...props}
      >
        {children}
      </Slot>
    );
  }

  return (
    <button ref={ref} disabled={disabled || loading} className={classes} {...props}>
      {loading && (
        <span
          aria-hidden
          className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
});
