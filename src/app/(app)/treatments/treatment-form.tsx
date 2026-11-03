"use client";

import { useRouter } from "next/navigation";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { useDialog } from "@/components/ui/dialog";
import { TREATMENT_CATEGORIES } from "@/lib/status";
import { saveTreatmentAction } from "./actions";

export type TreatmentValues = {
  id?: string;
  name?: string;
  category?: string;
  description?: string | null;
  defaultPrice?: number;
  defaultSessions?: number;
  sessionGapDays?: number;
  durationMins?: number;
  gstRate?: number;
  validityDays?: number;
  isActive?: boolean;
};

export function TreatmentForm({ values = {} }: { values?: TreatmentValues }) {
  const dialog = useDialog();
  const router = useRouter();
  return (
    <ActionForm
      action={saveTreatmentAction}
      resetOnSuccess={!values.id}
      onSuccess={(s) => {
        dialog?.close();
        if (!values.id && s?.id) router.push(`/treatments/catalog/${s.id}`);
      }}
    >
      {(s) => (
        <div className="space-y-4">
          {values.id && <input type="hidden" name="id" value={values.id} />}
          <FormGrid>
            <Field label="Treatment name" required error={fe(s, "name")} className="sm:col-span-2">
              <Input name="name" defaultValue={values.name} placeholder="e.g. Hydra Facial" required />
            </Field>
            <Field label="Category" required error={fe(s, "category")}>
              <Select name="category" defaultValue={values.category ?? "Facial"} options={TREATMENT_CATEGORIES.map((c) => [c, c] as const)} />
            </Field>
            <Field label="Price per session (₹, before GST)" required error={fe(s, "defaultPrice")}>
              <Input name="defaultPrice" type="number" min={0} step="1" defaultValue={values.defaultPrice ?? ""} required />
            </Field>
            <Field label="Usual number of sessions" required error={fe(s, "defaultSessions")}>
              <Input name="defaultSessions" type="number" min={1} defaultValue={values.defaultSessions ?? 1} required />
            </Field>
            <Field label="Gap between sessions (days)" error={fe(s, "sessionGapDays")}>
              <Input name="sessionGapDays" type="number" min={0} defaultValue={values.sessionGapDays ?? 30} />
            </Field>
            <Field label="Duration (minutes)" required error={fe(s, "durationMins")}>
              <Input name="durationMins" type="number" min={5} step={5} defaultValue={values.durationMins ?? 60} required />
            </Field>
            <Field label="GST rate (%)" required error={fe(s, "gstRate")}>
              <Select name="gstRate" defaultValue={String(values.gstRate ?? 18)} options={["0", "5", "12", "18", "28"].map((r) => [r, `${r}%`] as const)} />
            </Field>
            <Field label="Package validity (days)" required error={fe(s, "validityDays")} hint="Packages expire this many days after purchase">
              <Input name="validityDays" type="number" min={1} defaultValue={values.validityDays ?? 365} required />
            </Field>
          </FormGrid>
          <Field label="Description" error={fe(s, "description")}>
            <Textarea name="description" rows={2} defaultValue={values.description ?? ""} />
          </Field>
          <Checkbox name="isActive" defaultChecked={values.isActive ?? true} label="Active — available for booking and billing" />
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">{values.id ? "Save changes" : "Add treatment"}</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
