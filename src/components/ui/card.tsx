import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/format";
import type { Tone } from "@/lib/status";

export function Card({ className, children, id }: { className?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className={cn("rounded-xl border border-border bg-surface shadow-card", className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description && <div className="mt-0.5 text-[13px] text-muted">{description}</div>}
      </div>
      {actions && <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-4 py-4 sm:px-5", className)}>{children}</div>;
}

const toneText: Record<Tone, string> = {
  neutral: "text-ink-2 bg-surface-3",
  accent: "text-accent bg-accent-soft",
  success: "text-success bg-success-soft",
  warning: "text-warning bg-warning-soft",
  danger: "text-danger bg-danger-soft",
  info: "text-info bg-info-soft",
  violet: "text-violet bg-violet-soft",
};

export function toneClass(tone: Tone) {
  return toneText[tone];
}

/** KPI tile. */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
  href,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  href?: string;
  className?: string;
}) {
  const inner = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        <p className="tabular mt-1.5 truncate text-[22px] font-semibold tracking-tight text-ink">{value}</p>
        {hint && <p className="mt-1 line-clamp-2 text-xs text-muted sm:truncate">{hint}</p>}
      </div>
      {icon && <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", toneText[tone])}>{icon}</span>}
    </div>
  );
  const cls = cn("block rounded-xl border border-border bg-surface p-4 shadow-card", href && "transition-colors hover:border-border-strong", className);
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-surface-3 text-muted">{icon}</div>}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && <div className="mt-1 max-w-sm text-[13px] text-muted">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Label/value list for detail panels. */
export function DetailList({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-sm text-ink">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
