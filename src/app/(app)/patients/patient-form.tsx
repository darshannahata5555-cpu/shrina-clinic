"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { LEAD_SOURCES, SKIN_TYPES } from "@/lib/status";
import { ageFrom } from "@/lib/format";
import { savePatientAction } from "./actions";

export type PatientFormValues = {
  id?: string;
  fullName?: string;
  mobile?: string;
  altMobile?: string | null;
  email?: string | null;
  dob?: string; // YYYY-MM-DD
  gender?: string | null;
  address?: string | null;
  city?: string | null;
  source?: string | null;
  referredBy?: string | null;
  assignedDoctorId?: string | null;
  branchId?: string | null;
  skinType?: string | null;
  allergies?: string | null;
  medicalHistory?: string | null;
  notes?: string | null;
  marketingConsent?: boolean;
  registeredAt?: string;
};

type Match = { id: string; code: string; fullName: string; branch: string; registered: string; canOpen: boolean };

export function PatientForm({
  values = {},
  doctors,
  branches,
  canMedical,
  cancelHref,
}: {
  values?: PatientFormValues;
  doctors: readonly (readonly [string, string])[];
  branches: { id: string; name: string }[];
  canMedical: boolean;
  cancelHref: string;
}) {
  const isEdit = !!values.id;
  const [mobile, setMobile] = useState(values.mobile ?? "");
  const [dob, setDob] = useState(values.dob ?? "");
  const [found, setFound] = useState<{ digits: string; matches: Match[] }>({ digits: "", matches: [] });
  const digits = mobile.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  const checkable = digits.length === 10 && !(isEdit && digits === values.mobile);
  const matches = checkable && found.digits === digits ? found.matches : [];

  useEffect(() => {
    if (!checkable) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/patients/check-mobile?mobile=${digits}${values.id ? `&exclude=${values.id}` : ""}`, { signal: ctrl.signal });
        if (r.ok) setFound({ digits, matches: (await r.json()).matches });
      } catch {
        /* aborted */
      }
    }, 300);
    return () => (clearTimeout(t), ctrl.abort());
  }, [digits, checkable, values.id]);

  const age = dob ? ageFrom(dob) : null;

  return (
    <ActionForm action={savePatientAction} refresh={false}>
      {(s) => (
        <div className="space-y-5">
          {values.id && <input type="hidden" name="id" value={values.id} />}

          <Card>
            <CardHeader title="Personal details" description={isEdit ? undefined : "A permanent Patient ID is generated automatically."} />
            <CardBody>
              <FormGrid>
                <Field label="Full name" required error={fe(s, "fullName")}>
                  <Input name="fullName" defaultValue={values.fullName} required autoFocus={!isEdit} />
                </Field>
                <Field label="Mobile number" required error={fe(s, "mobile")} hint="10-digit Indian mobile, used for reminders">
                  <Input name="mobile" inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} required aria-invalid={!!fe(s, "mobile") || undefined} />
                </Field>
                {matches.length > 0 && (
                  <div className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm sm:col-span-2">
                    <p className="flex items-center gap-2 font-medium text-warning">
                      <TriangleAlert className="h-4 w-4" /> Possible duplicate — this mobile is already registered
                    </p>
                    <ul className="mt-2 space-y-1 text-ink-2">
                      {matches.map((m) => (
                        <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            <span className="font-medium text-ink">{m.fullName}</span> · {m.code} · {m.branch} · registered {m.registered}
                          </span>
                          {m.canOpen && (
                            <Link href={`/patients/${m.id}`} className="text-[13px] text-accent hover:underline" target="_blank">
                              Open profile ↗
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                    <Checkbox name="confirmDuplicate" className="mt-3" label="This is a different person — register anyway (e.g. family member sharing a phone)" />
                    {fe(s, "confirmDuplicate") && <p className="mt-1 text-xs text-danger">{fe(s, "confirmDuplicate")}</p>}
                  </div>
                )}
                <Field label="Alternate mobile" error={fe(s, "altMobile")}>
                  <Input name="altMobile" inputMode="tel" defaultValue={values.altMobile ?? ""} />
                </Field>
                <Field label="Email" error={fe(s, "email")}>
                  <Input name="email" type="email" defaultValue={values.email ?? ""} />
                </Field>
                <Field label="Date of birth" error={fe(s, "dob")} hint={age !== null ? `Age: ${age} years` : "Age is calculated automatically"}>
                  <Input name="dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
                </Field>
                <Field label="Gender" error={fe(s, "gender")}>
                  <Select name="gender" defaultValue={values.gender ?? ""} placeholder="Select" options={[["FEMALE", "Female"], ["MALE", "Male"], ["OTHER", "Other"]]} />
                </Field>
                <Field label="Address" error={fe(s, "address")} className="sm:col-span-2">
                  <Textarea name="address" rows={2} defaultValue={values.address ?? ""} />
                </Field>
                <Field label="City" error={fe(s, "city")}>
                  <Input name="city" defaultValue={values.city ?? ""} />
                </Field>
              </FormGrid>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Clinic details" />
            <CardBody>
              <FormGrid>
                {!isEdit && branches.length > 1 && (
                  <Field label="Branch" required error={fe(s, "branchId")}>
                    <Select name="branchId" defaultValue={values.branchId ?? ""} options={branches.map((b) => [b.id, b.name] as const)} required />
                  </Field>
                )}
                {!isEdit && branches.length === 1 && <input type="hidden" name="branchId" value={branches[0]!.id} />}
                <Field label="Assigned doctor" error={fe(s, "assignedDoctorId")}>
                  <Select name="assignedDoctorId" defaultValue={values.assignedDoctorId ?? ""} placeholder="Not assigned" options={doctors} />
                </Field>
                <Field label="Patient source" error={fe(s, "source")} hint="How did they hear about SHRINA?">
                  <Select name="source" defaultValue={values.source ?? ""} placeholder="Select" options={LEAD_SOURCES} />
                </Field>
                <Field label="Referred by" error={fe(s, "referredBy")}>
                  <Input name="referredBy" defaultValue={values.referredBy ?? ""} placeholder="Name of referring patient / doctor" />
                </Field>
                <Field label="Registration date" error={fe(s, "registeredAt")} hint={isEdit ? undefined : "Defaults to today — change only for migrated records"}>
                  <Input name="registeredAt" type="date" defaultValue={values.registeredAt ?? ""} />
                </Field>
              </FormGrid>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Skin & medical" description={canMedical ? "Medical history is confidential — visible only to doctors and the owner." : undefined} />
            <CardBody>
              <FormGrid>
                <Field label="Skin type" error={fe(s, "skinType")}>
                  <Select name="skinType" defaultValue={values.skinType ?? ""} placeholder="Not assessed" options={SKIN_TYPES.map((t) => [t, t] as const)} />
                </Field>
                <Field label="Allergies" error={fe(s, "allergies")} hint="Visible to all treating staff">
                  <Input name="allergies" defaultValue={values.allergies ?? ""} placeholder="e.g. Lidocaine, latex, fragrance" />
                </Field>
                {canMedical && (
                  <Field label="Medical history" error={fe(s, "medicalHistory")} className="sm:col-span-2">
                    <Textarea name="medicalHistory" rows={3} defaultValue={values.medicalHistory ?? ""} placeholder="Conditions, medications, past procedures, pregnancy…" />
                  </Field>
                )}
                <Field label="Additional notes" error={fe(s, "notes")} className="sm:col-span-2">
                  <Textarea name="notes" rows={2} defaultValue={values.notes ?? ""} placeholder="Preferences, preferred slots, language…" />
                </Field>
                <div className="sm:col-span-2">
                  <Checkbox name="marketingConsent" defaultChecked={values.marketingConsent} label="Patient agrees to receive offers & updates on WhatsApp / SMS / email" />
                </div>
              </FormGrid>
            </CardBody>
          </Card>

          <div className="flex flex-wrap justify-end gap-2">
            <LinkButton href={cancelHref} variant="outline">
              Cancel
            </LinkButton>
            <SubmitButton pendingText="Saving…">{isEdit ? "Save changes" : "Register patient"}</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
