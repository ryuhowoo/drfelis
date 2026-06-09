// 대시 그룹 공통 스켈레톤 — Next.js App Router loading.tsx 컨벤션.
// 페이지의 비동기 데이터 fetch 중 자동으로 <Suspense> fallback 으로 표시됨.
// 신선도(force-dynamic) 유지를 위해 캐싱(revalidate)은 도입하지 않음.

export default function DashLoading() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="h-12 w-12 animate-pulse rounded-2xl bg-canvas card-soft" />
        <div className="space-y-2">
          <div className="h-3.5 w-24 animate-pulse rounded-full bg-soft" />
          <div className="h-2.5 w-32 animate-pulse rounded-full bg-soft" />
        </div>
      </div>

      <div className="mb-5 rounded-[28px] bg-canvas p-6 card-soft">
        <div className="h-3 w-20 animate-pulse rounded-full bg-soft" />
        <div className="mt-3 h-4 w-3/4 animate-pulse rounded-full bg-soft" />
        <div className="mt-2 h-4 w-1/2 animate-pulse rounded-full bg-soft" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-[24px] bg-canvas p-5 card-soft">
            <div className="h-2.5 w-16 animate-pulse rounded-full bg-soft" />
            <div className="mt-3 h-6 w-24 animate-pulse rounded-full bg-soft" />
            <div className="mt-2 h-2 w-20 animate-pulse rounded-full bg-soft" />
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className={`rounded-[28px] bg-canvas p-5 card-soft ${
              i === 1 ? "lg:col-span-2" : ""
            }`}
          >
            <div className="h-3 w-32 animate-pulse rounded-full bg-soft" />
            <div className="mt-4 h-32 animate-pulse rounded-2xl bg-soft" />
          </div>
        ))}
      </div>
    </div>
  );
}
