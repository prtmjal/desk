export default function Loading() {
  return (
    <div className="container-page py-8" role="status" aria-live="polite">
      <div className="h-7 w-40 animate-pulse rounded bg-bg-subtle" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg bg-bg-subtle" />
        ))}
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
