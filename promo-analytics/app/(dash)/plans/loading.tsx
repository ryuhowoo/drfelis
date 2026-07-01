export default function PlansLoading() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <div className="h-6 w-28 animate-pulse rounded-full bg-soft" />
      <div className="mt-2 h-3 w-80 animate-pulse rounded-full bg-soft" />

      <div className="mt-5 flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-8 w-24 animate-pulse rounded-xl bg-soft" />
        ))}
      </div>

      <div className="mt-5 rounded-2xl p-4 card-soft">
        <div className="space-y-2.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="grid grid-cols-12 items-center gap-3">
              <div className="col-span-5 h-3.5 animate-pulse rounded-full bg-soft" />
              <div className="col-span-2 h-3.5 animate-pulse rounded-full bg-soft" />
              <div className="col-span-2 h-3.5 animate-pulse rounded-full bg-soft" />
              <div className="col-span-3 h-3.5 animate-pulse rounded-full bg-soft" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
