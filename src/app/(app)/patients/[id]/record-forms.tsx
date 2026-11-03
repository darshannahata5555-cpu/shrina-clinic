"use client";

import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea, controlClass } from "@/components/ui/field";
import { useDialog } from "@/components/ui/dialog";
import { addConsentAction, addMedicalEntryAction } from "./actions";

export function ConsentForm({ patientId, today, types }: { patientId: string; today: string; types: readonly (readonly [string, string])[] }) {
  const dialog = useDialog();
  return (
    <ActionForm action={addConsentAction} resetOnSuccess onSuccess={() => dialog?.close()}>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="patientId" value={patientId} />
          <FormGrid>
            <Field label="Consent type" required error={fe(s, "type")}>
              <Select name="type" options={types} required />
            </Field>
            <Field label="Date signed" error={fe(s, "signedAt")}>
              <Input name="signedAt" type="date" defaultValue={today} max={today} />
            </Field>
          </FormGrid>
          <Field label="Signed form (optional)" error={fe(s, "document")} hint="PDF or photo of the signed consent form · max 10 MB">
            <input name="document" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" className={`${controlClass} file:mr-3 file:rounded-md file:border-0 file:bg-surface-3 file:px-2.5 file:py-1 file:text-[13px] file:text-ink`} />
          </Field>
          <Field label="Notes" error={fe(s, "notes")} hint="Required for marketing-photo consent if no signed form is attached">
            <Textarea name="notes" rows={2} placeholder="e.g. Consent explained in Hindi; patient signed paper form #214" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">Record consent</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function MedicalEntryForm({ patientId, categories }: { patientId: string; categories: readonly (readonly [string, string])[] }) {
  const dialog = useDialog();
  return (
    <ActionForm action={addMedicalEntryAction} resetOnSuccess onSuccess={() => dialog?.close()}>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="patientId" value={patientId} />
          <Field label="Category" required error={fe(s, "category")}>
            <Select name="category" options={categories} required />
          </Field>
          <Field label="Details" required error={fe(s, "description")}>
            <Textarea name="description" rows={3} required placeholder="e.g. Hypothyroidism — on Thyronorm 50 mcg daily" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">Add record</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
