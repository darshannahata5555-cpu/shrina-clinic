"use client";

import { Lock } from "lucide-react";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { useDialog } from "@/components/ui/dialog";
import { SKIN_TYPES } from "@/lib/status";
import { saveConsultationAction } from "./actions";

export type ConsultationValues = {
  id?: string;
  doctorId?: string | null;
  consultationDate?: string; // datetime-local
  complaint?: string | null;
  medicalHistory?: string | null;
  skinAssessment?: string | null;
  skinType?: string | null;
  treatmentRecommended?: string | null;
  treatmentPerformed?: string | null;
  productsRecommended?: string | null;
  homeCare?: string | null;
  doctorNotes?: string | null;
  followUpDate?: string;
};

export function ConsultationForm({
  patientId,
  branchId,
  doctors,
  canMedical,
  values = {},
}: {
  patientId: string;
  branchId: string;
  doctors: readonly (readonly [string, string])[];
  canMedical: boolean;
  values?: ConsultationValues;
}) {
  const dialog = useDialog();
  return (
    <ActionForm action={saveConsultationAction} resetOnSuccess={!values.id} onSuccess={() => dialog?.close()}>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="patientId" value={patientId} />
          <input type="hidden" name="branchId" value={branchId} />
          {values.id && <input type="hidden" name="id" value={values.id} />}
          <FormGrid>
            <Field label="Doctor" required error={fe(s, "doctorId")}>
              <Select name="doctorId" defaultValue={values.doctorId ?? ""} placeholder="Select doctor" options={doctors} required />
            </Field>
            <Field label="Consultation date & time" required error={fe(s, "consultationDate")}>
              <Input name="consultationDate" type="datetime-local" defaultValue={values.consultationDate} required />
            </Field>
          </FormGrid>
          <Field label="Patient complaint / concern" error={fe(s, "complaint")}>
            <Textarea name="complaint" rows={2} defaultValue={values.complaint ?? ""} placeholder="e.g. Pigmentation on cheeks for 1 year, worse after sun exposure" />
          </Field>
          <FormGrid>
            <Field label="Skin assessment" error={fe(s, "skinAssessment")} className="sm:col-span-2">
              <Textarea name="skinAssessment" rows={2} defaultValue={values.skinAssessment ?? ""} placeholder="Fitzpatrick type, texture, pigmentation, acne grade, barrier…" />
            </Field>
            <Field label="Skin type" error={fe(s, "skinType")}>
              <Select name="skinType" defaultValue={values.skinType ?? ""} placeholder="Select" options={SKIN_TYPES.map((t) => [t, t] as const)} />
            </Field>
            <Field label="Follow-up date" error={fe(s, "followUpDate")} hint="Shows on the dashboard follow-up list">
              <Input name="followUpDate" type="date" defaultValue={values.followUpDate ?? ""} />
            </Field>
            <Field label="Treatment recommended" error={fe(s, "treatmentRecommended")}>
              <Textarea name="treatmentRecommended" rows={2} defaultValue={values.treatmentRecommended ?? ""} />
            </Field>
            <Field label="Treatment performed today" error={fe(s, "treatmentPerformed")}>
              <Textarea name="treatmentPerformed" rows={2} defaultValue={values.treatmentPerformed ?? ""} />
            </Field>
            <Field label="Products recommended" error={fe(s, "productsRecommended")}>
              <Textarea name="productsRecommended" rows={2} defaultValue={values.productsRecommended ?? ""} />
            </Field>
            <Field label="Home-care instructions" error={fe(s, "homeCare")}>
              <Textarea name="homeCare" rows={2} defaultValue={values.homeCare ?? ""} />
            </Field>
          </FormGrid>
          {canMedical ? (
            <div className="space-y-4 rounded-xl border border-border bg-surface-2 p-4">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
                <Lock className="h-3.5 w-3.5" /> Confidential — visible to doctors and the owner only
              </p>
              <Field label="Medical history noted at this visit" error={fe(s, "medicalHistory")}>
                <Textarea name="medicalHistory" rows={2} defaultValue={values.medicalHistory ?? ""} />
              </Field>
              <Field label="Doctor's notes" error={fe(s, "doctorNotes")}>
                <Textarea name="doctorNotes" rows={3} defaultValue={values.doctorNotes ?? ""} />
              </Field>
            </div>
          ) : null}
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">{values.id ? "Save changes" : "Save consultation"}</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
