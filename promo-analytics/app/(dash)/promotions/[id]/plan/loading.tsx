export default function PlanLoading() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <div className="h-3 w-52 animate-pulse rounded-full bg-soft" />
      <div className="mt-3 h-6 w-80 animate-pulse rounded-full bg-soft" />
      <div className="mt-2 h-3 w-44 animate-pulse rounded-full bg-soft" />

      {/* 목적별 총합 헤더 */}
      <div className="mt-5 rounded-2xl p-5 card-soft">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-soft" />
          ))}
        </div>
      </div>

      {/* 쿠폰·사은품 카드 + 옵션 카드들 */}
      <div className="mt-3 h-24 animate-pulse rounded-2xl bg-soft" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="mt-4 rounded-2xl p-4 card-soft">
          <div className="h-8 w-3/5 animate-pulse rounded-lg bg-soft" />
          <div className="mt-3 h-20 animate-pulse rounded-xl bg-soft" />
          <div className="mt-3 h-10 animate-pulse rounded-lg bg-soft" />
        </div>
      ))}
    </div>
  );
}
