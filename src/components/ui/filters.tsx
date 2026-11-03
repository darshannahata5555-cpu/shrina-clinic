"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { controlBase, controlClass, type Option } from "./field";
import { cn } from "@/lib/format";

/** Updates URL search params (resetting `page`). */
function useParamSetter() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    const q = next.toString();
    start(() => router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }));
  };
  return { sp, set, pending };
}

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

/** Debounced search box bound to ?{name}= */
export function SearchParamInput({ name = "q", placeholder = "Search…", className }: { name?: string; placeholder?: string; className?: string }) {
  const { sp, set } = useParamSetter();
  const [value, setValue] = useState(sp.get(name) ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get(name) ?? "") !== value) set({ [name]: value || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cn("relative w-full sm:w-64", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className={cn(controlClass, "h-9 pl-8 pr-8")} />
      {value && (
        <button type="button" onClick={() => setValue("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink" aria-label="Clear">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** Select bound to ?{name}= */
export function SelectParam({
  name,
  options,
  placeholder = "All",
  className,
}: {
  name: string;
  options: readonly Option[];
  placeholder?: string;
  className?: string;
}) {
  const { sp, set } = useParamSetter();
  return (
    <select
      value={sp.get(name) ?? ""}
      onChange={(e) => set({ [name]: e.target.value || null })}
      className={cn(controlBase, "h-9 w-auto min-w-36 max-w-full pr-8")}
    >
      <option value="">{placeholder}</option>
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

/** Date input bound to ?{name}= (YYYY-MM-DD) */
export function DateParam({ name, label, className, type = "date" }: { name: string; label?: string; className?: string; type?: "date" | "month" }) {
  const { sp, set } = useParamSetter();
  return (
    <label className={cn("inline-flex items-center gap-1.5 text-[13px] text-muted", className)}>
      {label}
      <input type={type} value={sp.get(name) ?? ""} onChange={(e) => set({ [name]: e.target.value || null })} className={cn(controlBase, "h-9 w-auto")} />
    </label>
  );
}

/** Segmented control bound to ?{name}= */
export function SegmentParam({
  name,
  options,
  defaultValue,
}: {
  name: string;
  options: readonly (readonly [string, string])[];
  defaultValue: string;
}) {
  const { sp, set } = useParamSetter();
  const current = sp.get(name) ?? defaultValue;
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 shadow-card">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          onClick={() => set({ [name]: v === defaultValue ? null : v })}
          className={cn(
            "rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
            current === v ? "bg-ink text-bg" : "text-muted hover:text-ink",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
