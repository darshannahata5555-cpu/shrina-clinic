"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { cn } from "@/lib/format";
import { mergePatientsAction } from "./actions";

export type DupPatient = {
  id: string;
  code: string;
  fullName: string;
  branch: string;
  registered: string;
  lastVisit: string | null;
  email: string | null;
  counts: { appointments: number; invoices: number; packages: number; consultations: number };
};

export function MergeForm({ patients, canMerge }: { patients: DupPatient[]; canMerge: boolean }) {
  const richest = [...patients].sort(
    (a, b) =>
      b.counts.appointments + b.counts.invoices + b.counts.packages + b.counts.consultations -
      (a.counts.appointments + a.counts.invoices + a.counts.packages + a.counts.consultations),
  )[0]!;
  const [primary, setPrimary] = useState(richest.id);
  const [merge, setMerge] = useState<Set<string>>(new Set(patients.filter((p) => p.id !== richest.id).map((p) => p.id)));
  const toMerge = [...merge].filter((id) => id !== primary);
  const primaryP = patients.find((p) => p.id === primary)!;

  return (
    <ActionForm action={mergePatientsAction}>
      <input type="hidden" name="primaryId" value={primary} />
      {toMerge.map((id) => (
        <input key={id} type="hidden" name="mergeIds" value={id} />
      ))}
      <div className="divide-y divide-border">
        {patients.map((p) => {
          const isPrimary = p.id === primary;
          return (
            <div key={p.id} className={cn("flex flex-wrap items-center gap-4 px-4 py-3 sm:px-5", isPrimary && "bg-success-soft/40")}>
              {canMerge && (
                <div className="flex shrink-0 flex-col gap-1.5 text-[13px]">
                  <label className="inline-flex cursor-pointer items-center gap-1.5">
                    <input type="radio" checked={isPrimary} onChange={() => setPrimary(p.id)} className="accent-[var(--accent)]" /> Keep
                  </label>
                  {!isPrimary && (
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-muted">
                      <input
                        type="checkbox"
                        checked={merge.has(p.id)}
                        onChange={(e) => {
                          const next = new Set(merge);
                          if (e.target.checked) next.add(p.id);
                          else next.delete(p.id);
                          setMerge(next);
                        }}
                        className="accent-[var(--accent)]"
                      />{" "}
                      Merge
                    </label>
                  )}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <Link href={`/patients/${p.id}`} className="font-medium text-ink hover:text-accent">
                  {p.fullName}
                </Link>
                <p className="text-xs text-muted">
                  {p.code} · {p.branch} · registered {p.registered}
                  {p.lastVisit ? ` · last visit ${p.lastVisit}` : " · no visits"}
                  {p.email ? ` · ${p.email}` : ""}
                </p>
              </div>
              <p className="tabular text-xs text-ink-2">
                {p.counts.appointments} appts · {p.counts.packages} packages · {p.counts.invoices} invoices · {p.counts.consultations} consults
              </p>
            </div>
          );
        })}
      </div>
      {canMerge && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
          <p className="text-[13px] text-muted">
            {toMerge.length
              ? `All history from ${toMerge.length} record${toMerge.length > 1 ? "s" : ""} moves to ${primaryP.code}; the duplicate${toMerge.length > 1 ? "s are" : " is"} archived.`
              : "Tick at least one record to merge."}
          </p>
          <SubmitButton variant="outline" size="sm" disabled={!toMerge.length} pendingText="Merging…" onClick={(e) => {
            if (!window.confirm(`Merge into ${primaryP.fullName} (${primaryP.code})? This moves all appointments, packages, invoices and records.`)) e.preventDefault();
          }}>
            Merge into {primaryP.code}
          </SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}
