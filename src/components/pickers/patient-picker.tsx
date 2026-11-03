"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Search, X } from "lucide-react";
import { controlClass } from "@/components/ui/field";
import { cn, initials } from "@/lib/format";

export type PickedPatient = { id: string; code: string; fullName: string; mobile: string; branch?: string };

/**
 * Patient search-and-select. Submits the chosen id as a hidden input `name` (default "patientId").
 * Uses the global search API (name / mobile / Patient ID across accessible branches).
 */
export function PatientPicker({
  name = "patientId",
  defaultValue,
  onChange,
  required,
  invalid,
  placeholder = "Search by name, mobile or Patient ID",
  autoFocus,
}: {
  name?: string;
  defaultValue?: PickedPatient | null;
  onChange?: (p: PickedPatient | null) => void;
  required?: boolean;
  invalid?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [picked, setPicked] = useState<PickedPatient | null>(defaultValue ?? null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PickedPatient[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setHits([]);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (r.ok) {
          setHits((await r.json()).patients);
          setActive(0);
          setOpen(true);
        }
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => (clearTimeout(t), ctrl.abort());
  }, [q]);

  const choose = (p: PickedPatient | null) => {
    setPicked(p);
    setOpen(false);
    setQ("");
    onChange?.(p);
  };

  if (picked) {
    return (
      <div className={cn(controlClass, "flex h-auto min-h-9.5 items-center gap-2.5 py-1.5")}>
        <input type="hidden" name={name} value={picked.id} />
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">{initials(picked.fullName)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{picked.fullName}</span>
          <span className="block truncate text-xs text-muted">
            {picked.code} · {picked.mobile}
            {picked.branch ? ` · ${picked.branch}` : ""}
          </span>
        </span>
        <button type="button" onClick={() => choose(null)} className="rounded p-1 text-muted hover:bg-surface-3 hover:text-ink" aria-label="Change patient">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={box} className="relative">
      <input type="hidden" name={name} value="" required={required} />
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        value={q}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onKeyDown={(e) => {
          if (!open || !hits.length) return;
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, hits.length - 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          if (e.key === "Enter") (e.preventDefault(), choose(hits[active]!));
        }}
        placeholder={placeholder}
        className={cn(controlClass, "h-9.5 pl-8")}
      />
      {loading && <LoaderCircle className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />}
      {open && q.trim().length >= 2 && (
        <ul className="absolute inset-x-0 top-11 z-50 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-pop">
          {hits.length === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-muted">{loading ? "Searching…" : "No patients found"}</li>
          ) : (
            hits.map((h, i) => (
              <li key={h.id}>
                <button type="button" onMouseEnter={() => setActive(i)} onClick={() => choose(h)} className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left", i === active && "bg-surface-3")}>
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">{initials(h.fullName)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink">{h.fullName}</span>
                    <span className="block truncate text-xs text-muted">
                      {h.code} · {h.mobile} · {h.branch}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
