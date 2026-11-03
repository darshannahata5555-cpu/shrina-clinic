"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { PatientPicker, type PickedPatient } from "@/components/pickers/patient-picker";
import { LEAD_SOURCES } from "@/lib/status";
import { patientPackagesAction, saveAppointmentAction } from "./actions";

type Pkg = Awaited<ReturnType<typeof patientPackagesAction>>[number];
type Clinician = { id: string; fullName: string; staffType: string; branchId: string };

export type AppointmentFormValues = {
  id?: string;
  patient?: PickedPatient | null;
  treatmentId?: string | null;
  packageId?: string | null;
  packageLabel?: string | null;
  doctorId?: string | null;
  therapistId?: string | null;
  branchId?: string | null;
  date?: string;
  time?: string;
  duration?: number;
  source?: string;
  notes?: string | null;
};

export function AppointmentForm({
  values,
  treatments,
  clinicians,
  branches,
  initialPackages = [],
}: {
  values: AppointmentFormValues;
  treatments: { id: string; name: string; category: string; durationMins: number }[];
  clinicians: Clinician[];
  branches: { id: string; name: string; openTime: string; closeTime: string }[];
  initialPackages?: Pkg[];
}) {
  const router = useRouter();
  const editing = !!values.id;
  const [packages, setPackages] = useState<Pkg[]>(initialPackages);
  const [packageId, setPackageId] = useState(values.packageId ?? "");
  const [treatmentId, setTreatmentId] = useState(values.treatmentId ?? "");
  const [doctorId, setDoctorId] = useState(values.doctorId ?? "");
  const [therapistId, setTherapistId] = useState(values.therapistId ?? "");
  const [branchId, setBranchId] = useState(values.branchId ?? branches[0]?.id ?? "");
  const [duration, setDuration] = useState(String(values.duration ?? 30));
  const [loadingPkgs, start] = useTransition();

  const applyPackage = (id: string, list = packages) => {
    setPackageId(id);
    const p = list.find((x) => x.id === id);
    if (!p) return;
    setTreatmentId(p.treatmentId);
    if (p.doctorId) setDoctorId(p.doctorId);
    if (p.therapistId) setTherapistId(p.therapistId);
    setDuration(String(p.durationMins));
    if (branches.some((b) => b.id === p.branchId)) setBranchId(p.branchId);
  };

  // Prefill from ?packageId= on first render.
  useEffect(() => {
    if (!editing && values.packageId && initialPackages.length) applyPackage(values.packageId, initialPackages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPatient = (p: PickedPatient | null) => {
    setPackages([]);
    setPackageId("");
    if (!p) return;
    start(async () => setPackages(await patientPackagesAction(p.id)));
  };

  const forBranch = (type: string, current: string) =>
    clinicians
      .filter((c) => c.staffType === type && (c.branchId === branchId || c.id === current))
      .map((c) => [c.id, c.fullName] as const);
  const doctors = useMemo(() => forBranch("DOCTOR", doctorId), [clinicians, branchId, doctorId]); // eslint-disable-line react-hooks/exhaustive-deps
  const therapists = useMemo(() => forBranch("THERAPIST", therapistId), [clinicians, branchId, therapistId]); // eslint-disable-line react-hooks/exhaustive-deps
  const branch = branches.find((b) => b.id === branchId);

  const grouped = useMemo(() => {
    const g = new Map<string, typeof treatments>();
    for (const t of treatments) g.set(t.category, [...(g.get(t.category) ?? []), t]);
    return [...g.entries()];
  }, [treatments]);

  return (
    <ActionForm action={saveAppointmentAction} onSuccess={(s) => editing && s?.id && router.push(`/appointments/${s.id}`)}>
      {(s) => (
        <div className="space-y-5">
          {editing && <input type="hidden" name="id" value={values.id} />}
          <Field label="Patient" required error={fe(s, "patientId")}>
            {editing ? (
              <>
                <input type="hidden" name="patientId" value={values.patient?.id} />
                <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">
                  {values.patient?.fullName} <span className="text-muted">· {values.patient?.code}</span>
                </p>
              </>
            ) : (
              <PatientPicker defaultValue={values.patient} onChange={onPatient} invalid={!!fe(s, "patientId")} autoFocus={!values.patient} />
            )}
          </Field>

          {editing ? (
            values.packageLabel && (
              <Field label="Package">
                <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">{values.packageLabel}</p>
              </Field>
            )
          ) : (
            <Field
              label="Treatment package"
              error={fe(s, "packageId")}
              hint={loadingPkgs ? "Loading packages…" : packages.length ? "Booking against a package plans the next session automatically." : "No active package — book a one-off treatment or consultation."}
            >
              <Select
                name="packageId"
                value={packageId}
                onChange={(e) => (e.target.value ? applyPackage(e.target.value) : setPackageId(""))}
                placeholder={packages.length ? "No package (one-off visit)" : "—"}
                disabled={!packages.length}
                options={packages.map((p) => [p.id, `${p.name} — ${p.remaining} of ${p.total} left${p.expiryDate ? ` · expires ${p.expiryDate}` : ""}`] as const)}
              />
            </Field>
          )}

          <FormGrid>
            <Field label="Treatment" error={fe(s, "treatmentId")} className="sm:col-span-2">
              <select
                name="treatmentId"
                value={treatmentId}
                disabled={!!packageId}
                onChange={(e) => {
                  setTreatmentId(e.target.value);
                  const t = treatments.find((x) => x.id === e.target.value);
                  if (t) setDuration(String(t.durationMins));
                }}
                className="h-9.5 w-full rounded-lg border border-border bg-surface px-3 text-sm text-ink shadow-card focus:border-accent focus:outline-none disabled:opacity-70"
              >
                <option value="">Consultation / not decided</option>
                {grouped.map(([cat, list]) => (
                  <optgroup key={cat} label={cat}>
                    {list.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.durationMins} min)
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {packageId && <input type="hidden" name="treatmentId" value={treatmentId} />}
            </Field>

            {branches.length > 1 ? (
              <Field label="Branch" required error={fe(s, "branchId")}>
                <Select name="branchId" value={branchId} onChange={(e) => setBranchId(e.target.value)} options={branches.map((b) => [b.id, b.name] as const)} />
              </Field>
            ) : (
              <input type="hidden" name="branchId" value={branchId} />
            )}
            <Field label="Booking source" error={fe(s, "source")}>
              <Select name="source" defaultValue={values.source ?? "PHONE"} options={LEAD_SOURCES} />
            </Field>

            <Field label="Doctor" error={fe(s, "doctorId")}>
              <Select name="doctorId" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} placeholder="No doctor" options={doctors} />
            </Field>
            <Field label="Therapist" error={fe(s, "therapistId")}>
              <Select name="therapistId" value={therapistId} onChange={(e) => setTherapistId(e.target.value)} placeholder="No therapist" options={therapists} />
            </Field>

            <Field label="Date" required error={fe(s, "date")}>
              <Input type="date" name="date" defaultValue={values.date} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Time" required error={fe(s, "time")} hint={branch ? `Open ${branch.openTime}–${branch.closeTime}` : undefined}>
                <Input type="time" name="time" step={900} defaultValue={values.time} required />
              </Field>
              <Field label="Duration" error={fe(s, "duration")}>
                <Select
                  name="duration"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  options={[...new Set([15, 20, 30, 45, 60, 75, 90, 120, 150, 180, Number(duration)])].sort((a, b) => a - b).map((m) => [String(m), m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m} min`] as const)}
                />
              </Field>
            </div>
          </FormGrid>

          <Field label="Notes" error={fe(s, "notes")}>
            <Textarea name="notes" defaultValue={values.notes ?? ""} rows={2} placeholder="e.g. prefers female therapist, first laser session, patch test done" />
          </Field>

          {!editing && <Checkbox name="confirmed" label="Patient has confirmed this slot" />}

          {fe(s, "_warn") && (
            <div className="rounded-lg border border-warning/30 bg-warning-soft px-3.5 py-3 text-sm text-warning">
              <p className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {fe(s, "_warn")}
              </p>
              <Checkbox name="override" label="I've checked — save anyway" className="mt-2.5 text-ink-2" />
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <SubmitButton pendingText="Saving…">{editing ? "Save changes" : "Book appointment"}</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
