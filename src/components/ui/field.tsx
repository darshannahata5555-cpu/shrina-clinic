import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/format";

/** Control styling without a width — combine with your own w-* class. */
export const controlBase =
  "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70 shadow-card transition-colors focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15 disabled:opacity-60 aria-invalid:border-danger";
/** Full-width control styling (default for form fields). */
export const controlClass = `${controlBase} w-full`;

/** Full width unless the caller already set a width (w-auto, w-40, sm:w-64…). */
const sized = (className?: string) => (className && /(^|\s)([a-z0-9]+:)*w-/.test(className) ? controlBase : controlClass);

export function Label({ className, ...p }: ComponentProps<"label">) {
  return <label className={cn("mb-1.5 block text-[13px] font-medium text-ink-2", className)} {...p} />;
}

export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input className={cn(sized(className), "h-9.5", className)} {...p} />;
}

export function Textarea({ className, rows = 3, ...p }: ComponentProps<"textarea">) {
  return <textarea rows={rows} className={cn(sized(className), "resize-y leading-relaxed", className)} {...p} />;
}

export type Option = { value: string; label: string } | readonly [string, string];

export function Select({
  className,
  options,
  placeholder,
  ...p
}: ComponentProps<"select"> & { options: readonly Option[]; placeholder?: string }) {
  return (
    <select className={cn(sized(className), "h-9.5 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => {
        const [v, l] = Array.isArray(o) ? o : [(o as { value: string }).value, (o as { label: string }).label];
        return (
          <option key={v} value={v}>
            {l}
          </option>
        );
      })}
    </select>
  );
}

export function Checkbox({ label, className, ...p }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm text-ink-2", className)}>
      <input type="checkbox" className="h-4 w-4 rounded border-border-strong accent-[var(--accent)]" {...p} />
      <span>{label}</span>
    </label>
  );
}

/** Label + control + hint + error. Pass the control as children. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: {
  label?: ReactNode;
  htmlFor?: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-accent">*</span>}
        </Label>
      )}
      {children}
      {error ? (
        <p className="mt-1 text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function FormGrid({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2", className)}>{children}</div>;
}
