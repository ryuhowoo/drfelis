export default function PromotionDetailLoading() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <div className="h-3 w-32 animate-pulse rounded-full bg-soft" />
      <div className="mt-4 h-5 w-60 animate-pulse rounded-full bg-soft" />
      <div className="mt-2 h-3 w-80 animate-pulse rounded-full bg-soft" />

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl p-4 card-soft">
            <div className="h-2.5 w-16 animate-pulse rounded-full bg-soft" />
            <div className="mt-3 h-5 w-24 animate-pulse rounded-full bg-soft" />
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl p-5 card-soft">
        <div className="h-3 w-32 animate-pulse rounded-full bg-soft" />
        <div className="mt-3 h-3 w-2/3 animate-pulse rounded-full bg-soft" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl p-4 card-soft">
            <div className="h-3 w-20 animate-pulse rounded-full bg-soft" />
            <div className="mt-3 h-7 w-16 animate-pulse rounded-full bg-soft" />
          </div>
        ))}
      </div>

      <div className="mt-4 h-72 animate-pulse rounded-2xl card-soft" />
    </div>
  );
}
