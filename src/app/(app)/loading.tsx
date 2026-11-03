export default function Loading() {
  return (
    <div className="animate-pulse space-y-5" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-56 rounded-lg bg-surface-3" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-surface-3/70" />
        ))}
      </div>
      <div className="h-80 rounded-xl bg-surface-3/60" />
    </div>
  );
}
