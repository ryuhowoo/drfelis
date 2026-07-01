export default function PredictLoading() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <div className="h-6 w-32 animate-pulse rounded-full bg-soft" />
      <div className="mt-2 h-3 w-72 animate-pulse rounded-full bg-soft" />

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="rounded-2xl p-5 card-soft">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-xl bg-soft" />
            ))}
          </div>
        </div>
        <div className="rounded-2xl p-5 card-soft">
          <div className="h-4 w-40 animate-pulse rounded-full bg-soft" />
          <div className="mt-4 grid grid-cols-3 gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-soft" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
