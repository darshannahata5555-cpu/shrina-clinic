"use client";

import { useMemo, useState } from "react";
import { PERMISSION_GROUPS } from "@/lib/permissions";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { cn } from "@/lib/format";
import type { ActionState } from "@/components/ui/form";
import { useDialog } from "@/components/ui/dialog";

/**
 * Checkbox grid of every permission, grouped. `baseline` marks the role default so
 * per-user overrides are visible (shown as "+ granted" / "− revoked").
 */
export function PermissionMatrix({
  action,
  hidden,
  initial,
  baseline,
  locked,
  submitLabel = "Save permissions",
  extraFields,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  hidden: Record<string, string>;
  initial: string[];
  baseline?: string[];
  locked?: boolean;
  submitLabel?: string;
  extraFields?: React.ReactNode;
}) {
  const dialog = useDialog();
  const [checked, setChecked] = useState(() => new Set(initial));
  const base = useMemo(() => (baseline ? new Set(baseline) : null), [baseline]);
  const toggle = (p: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  const changes = base ? [...new Set([...checked, ...base])].filter((p) => checked.has(p) !== base.has(p)).length : 0;

  return (
    <ActionForm action={action} onSuccess={() => dialog?.close()}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {[...checked].map((p) => (
        <input key={p} type="hidden" name="perm" value={p} />
      ))}
      {extraFields}
      <div className="grid gap-4 md:grid-cols-2">
        {PERMISSION_GROUPS.map((g) => {
          const keys = g.items.map((i) => i[0] as string);
          const allOn = keys.every((k) => checked.has(k));
          return (
            <fieldset key={g.group} className="rounded-xl border border-border p-3.5" disabled={locked}>
              <div className="mb-2 flex items-center justify-between">
                <legend className="text-[13px] font-semibold text-ink">{g.group}</legend>
                {!locked && (
                  <button
                    type="button"
                    className="text-xs text-accent hover:underline"
                    onClick={() =>
                      setChecked((s) => {
                        const n = new Set(s);
                        keys.forEach((k) => (allOn ? n.delete(k) : n.add(k)));
                        return n;
                      })
                    }
                  >
                    {allOn ? "Clear all" : "Select all"}
                  </button>
                )}
              </div>
              <ul className="space-y-1.5">
                {g.items.map(([key, label]) => {
                  const on = checked.has(key);
                  const diff = base && on !== base.has(key);
                  return (
                    <li key={key}>
                      <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-md px-1.5 py-1 text-[13px]", diff && "bg-violet-soft")}>
                        <input type="checkbox" checked={on} onChange={() => toggle(key)} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
                        <span className="flex-1 text-ink-2">
                          {label}
                          <span className="ml-1.5 font-mono text-[10.5px] text-muted">{key}</span>
                        </span>
                        {diff && <span className="shrink-0 text-[11px] font-medium text-violet">{on ? "+ granted" : "− revoked"}</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}
      </div>
      {!locked && (
        <div className="sticky bottom-0 mt-4 flex items-center justify-end gap-3 border-t border-border bg-surface/95 py-3 backdrop-blur">
          {base && <span className="text-[13px] text-muted">{changes ? `${changes} override${changes > 1 ? "s" : ""} vs role default` : "Matches role default"}</span>}
          {base && changes > 0 && (
            <button type="button" onClick={() => setChecked(new Set(base))} className="text-[13px] text-accent hover:underline">
              Reset to role default
            </button>
          )}
          <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}
