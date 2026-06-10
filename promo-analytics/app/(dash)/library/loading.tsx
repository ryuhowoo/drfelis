export default function LibraryLoading() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <div className="h-5 w-44 animate-pulse rounded-full bg-soft" />
      <div className="mt-2 h-3 w-72 animate-pulse rounded-full bg-soft" />

      <div className="mt-6 rounded-2xl p-4 card-soft">
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="grid grid-cols-12 items-center gap-3">
              <div className="col-span-4 h-3 animate-pulse rounded-full bg-soft" />
              <div className="col-span-2 h-3 animate-pulse rounded-full bg-soft" />
              <div className="col-span-2 h-3 animate-pulse rounded-full bg-soft" />
              <div className="col-span-2 h-3 animate-pulse rounded-full bg-soft" />
              <div className="col-span-2 h-3 animate-pulse rounded-full bg-soft" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
