import { cn } from "@/lib/format";

/** Sessions done / total bar. */
export function Progress({ done, total, className, wide }: { done: number; total: number; className?: string; wide?: boolean }) {
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className={cn("h-1.5 overflow-hidden rounded-full bg-surface-3", wide ? "flex-1" : "w-24")}>
        <div className={cn("h-full rounded-full", pct >= 100 ? "bg-success" : "bg-accent")} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular text-xs text-ink-2">
        {done}/{total}
      </span>
    </div>
  );
}
