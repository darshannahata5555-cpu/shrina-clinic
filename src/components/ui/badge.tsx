import type { ReactNode } from "react";
import { cn, humanize } from "@/lib/format";
import { STATUS, type StatusKind, type Tone } from "@/lib/status";
import { toneClass } from "./card";

export function Badge({ tone = "neutral", className, children, dot }: { tone?: Tone; className?: string; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", toneClass(tone), className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** <StatusBadge kind="invoice" status="PAID" /> */
export function StatusBadge({ kind, status, className }: { kind: StatusKind; status: string; className?: string }) {
  const entry = (STATUS[kind] as Record<string, [Tone, string]>)[status];
  return (
    <Badge tone={entry?.[0] ?? "neutral"} className={className} dot>
      {entry?.[1] ?? humanize(status)}
    </Badge>
  );
}
