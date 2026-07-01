export default function PrescribeLoading() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      <div className="h-6 w-32 animate-pulse rounded-full bg-soft" />
      <div className="mt-2 h-3 w-72 animate-pulse rounded-full bg-soft" />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl p-5 card-soft">
            <div className="h-4 w-32 animate-pulse rounded-full bg-soft" />
            <div className="mt-3 h-3 w-full animate-pulse rounded-full bg-soft" />
            <div className="mt-2 h-3 w-4/5 animate-pulse rounded-full bg-soft" />
            <div className="mt-4 h-8 w-24 animate-pulse rounded-xl bg-soft" />
          </div>
        ))}
      </div>
    </div>
  );
}
