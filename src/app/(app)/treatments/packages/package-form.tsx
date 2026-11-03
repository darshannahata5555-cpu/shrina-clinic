"use client";

import { useMemo, useState } from "react";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { PatientPicker, type PickedPatient } from "@/components/pickers/patient-picker";
import { addDaysKey, fmtDate, fromIst, money } from "@/lib/format";
import { createPackageAction } from "../actions";

type T = { id: string; name: string; category: string; defaultPrice: number; defaultSessions: number; validityDays: number; gstRate: number };
type Clinician = { id: string; fullName: string; staffType: string; branchId: string };

export function PackageForm({
  patient,
  lockPatient,
  treatments,
  clinicians,
  branches,
  today,
  defaults = {},
}: {
  patient: PickedPatient | null;
  lockPatient?: boolean;
  treatments: T[];
  clinicians: Clinician[];
  branches: { id: string; name: string }[];
  today: string;
  defaults?: { treatmentId?: string; totalSessions?: number; price?: number; bodyArea?: string | null; doctorId?: string | null; therapistId?: string | null; branchId?: string | null; renewedFromId?: string };
}) {
  const first = treatments.find((t) => t.id === defaults.treatmentId);
  const [treatmentId, setTreatmentId] = useState(defaults.treatmentId ?? "");
  const [sessions, setSessions] = useState(String(defaults.totalSessions ?? first?.defaultSessions ?? 1));
  const [price, setPrice] = useState(defaults.price !== undefined ? String(defaults.price) : first ? String(first.defaultPrice * (first.defaultSessions || 1)) : "");
  const [priceTouched, setPriceTouched] = useState(defaults.price !== undefined);
  const [purchase, setPurchase] = useState(today);
  const [branchId, setBranchId] = useState(defaults.branchId ?? branches[0]?.id ?? "");
  const t = treatments.find((x) => x.id === treatmentId);

  const grouped = useMemo(() => {
    const g = new Map<string, T[]>();
    for (const x of treatments) g.set(x.category, [...(g.get(x.category) ?? []), x]);
    return [...g.entries()];
  }, [treatments]);

  const pick = (id: string) => {
    setTreatmentId(id);
    const x = treatments.find((y) => y.id === id);
    if (!x) return;
    setSessions(String(x.defaultSessions));
    if (!priceTouched) setPrice(String(x.defaultPrice * x.defaultSessions));
  };
  const onSessions = (v: string) => {
    setSessions(v);
    if (t && !priceTouched && Number(v) > 0) setPrice(String(t.defaultPrice * Number(v)));
  };
  const n = Number(sessions) || 0;
  const p = Number(price) || 0;
  const expiryHint = t && /^\d{4}-\d{2}-\d{2}$/.test(purchase) ? fmtDate(fromIst(addDaysKey(purchase, t.validityDays))) : null;
  const staffFor = (type: string) => clinicians.filter((c) => c.staffType === type && c.branchId === branchId).map((c) => [c.id, c.fullName] as const);

  return (
    <ActionForm action={createPackageAction}>
      {(s) => (
        <div className="space-y-5">
          {defaults.renewedFromId && <input type="hidden" name="renewedFromId" value={defaults.renewedFromId} />}
          <Field label="Patient" required error={fe(s, "patientId")}>
            {lockPatient && patient ? (
              <>
                <input type="hidden" name="patientId" value={patient.id} />
                <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">
                  {patient.fullName} <span className="text-muted">· {patient.code}</span>
                </p>
              </>
            ) : (
              <PatientPicker defaultValue={patient} invalid={!!fe(s, "patientId")} autoFocus={!patient} />
            )}
          </Field>
          <FormGrid>
            <Field label="Treatment" required error={fe(s, "treatmentId")} className="sm:col-span-2">
              <select
                name="treatmentId"
                value={treatmentId}
                onChange={(e) => pick(e.target.value)}
                required
                className="h-9.5 w-full rounded-lg border border-border bg-surface px-3 text-sm text-ink shadow-card focus:border-accent focus:outline-none"
              >
                <option value="">Choose treatment</option>
                {grouped.map(([cat, list]) => (
                  <optgroup key={cat} label={cat}>
                    {list.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} — {money(x.defaultPrice, { decimals: false })}/session
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            <Field label="Body area" error={fe(s, "bodyArea")} hint="Where applicable, e.g. Full Body, Underarms, Face">
              <Input name="bodyArea" defaultValue={defaults.bodyArea ?? ""} />
            </Field>
            <Field label="Total sessions" required error={fe(s, "totalSessions")}>
              <Input name="totalSessions" type="number" min={1} max={100} value={sessions} onChange={(e) => onSessions(e.target.value)} required />
            </Field>
            <Field
              label="Package price (₹, before GST)"
              required
              error={fe(s, "price")}
              hint={n > 0 && p > 0 ? `${money(p / n)} per session${t ? ` · list ${money(t.defaultPrice * n, { decimals: false })}` : ""}` : undefined}
            >
              <Input
                name="price"
                type="number"
                min={0}
                step="1"
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                  setPriceTouched(true);
                }}
                required
              />
            </Field>
            {branches.length > 1 ? (
              <Field label="Branch" required error={fe(s, "branchId")}>
                <Select name="branchId" value={branchId} onChange={(e) => setBranchId(e.target.value)} options={branches.map((b) => [b.id, b.name] as const)} />
              </Field>
            ) : (
              <input type="hidden" name="branchId" value={branchId} />
            )}
            <Field label="Purchase date" required error={fe(s, "purchaseDate")}>
              <Input name="purchaseDate" type="date" value={purchase} max={today} onChange={(e) => setPurchase(e.target.value)} required />
            </Field>
            <Field label="Expiry date" error={fe(s, "expiryDate")} hint={expiryHint ? `Leave blank for ${expiryHint} (${t!.validityDays}-day validity)` : "Leave blank to use the treatment's validity"}>
              <Input name="expiryDate" type="date" min={purchase} />
            </Field>
            <Field label="Doctor" error={fe(s, "doctorId")}>
              <Select name="doctorId" defaultValue={defaults.doctorId ?? ""} placeholder="—" options={staffFor("DOCTOR")} />
            </Field>
            <Field label="Therapist" error={fe(s, "therapistId")}>
              <Select name="therapistId" defaultValue={defaults.therapistId ?? ""} placeholder="—" options={staffFor("THERAPIST")} />
            </Field>
            <Field label="Package name" error={fe(s, "name")} hint="Optional — generated from treatment, area and sessions" className="sm:col-span-2">
              <Input name="name" placeholder={t ? `${t.name} · ${n || "?"} sessions` : ""} />
            </Field>
          </FormGrid>
          <Field label="Treatment notes" error={fe(s, "notes")}>
            <Textarea name="notes" rows={2} placeholder="Plan, contraindications discussed, offers applied…" />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-[13px] text-muted">After saving you can bill the package and schedule the first session.</p>
            <SubmitButton pendingText="Saving…">{defaults.renewedFromId ? "Renew package" : "Create package"}</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
