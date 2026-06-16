import { cn } from "@/lib/cn";

// 로딩 스켈레톤 — 실제 콘텐츠와 레이아웃이 일치하도록 크기를 호출부에서 지정.
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-soft", className)}
      {...props}
    />
  );
}
