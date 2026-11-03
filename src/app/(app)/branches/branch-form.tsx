"use client";

import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Field, FormGrid, Input, Textarea } from "@/components/ui/field";
import { useDialog } from "@/components/ui/dialog";
import { saveBranchAction } from "./actions";

export type BranchFormValues = {
  id?: string;
  code?: string;
  name?: string;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  openTime?: string;
  closeTime?: string;
  lat?: number | null;
  lng?: number | null;
};

export function BranchForm({ values = {} }: { values?: BranchFormValues }) {
  const dialog = useDialog();
  return (
    <ActionForm action={saveBranchAction} onSuccess={() => dialog?.close()} resetOnSuccess={!values.id}>
      {(s) => (
        <div className="space-y-4">
          {values.id && <input type="hidden" name="id" value={values.id} />}
          <FormGrid>
            <Field label="Branch name" required error={fe(s, "name")}>
              <Input name="name" defaultValue={values.name} placeholder="SHRINA Bandra" required />
            </Field>
            <Field label="Short code" required error={fe(s, "code")} hint="Used in invoice numbers, e.g. FLG/2526/0001">
              <Input name="code" defaultValue={values.code} placeholder="BDR" maxLength={5} className="uppercase" required />
            </Field>
            <Field label="City" error={fe(s, "city")}>
              <Input name="city" defaultValue={values.city ?? ""} />
            </Field>
            <Field label="Phone" error={fe(s, "phone")}>
              <Input name="phone" defaultValue={values.phone ?? ""} />
            </Field>
            <Field label="Email" error={fe(s, "email")}>
              <Input name="email" type="email" defaultValue={values.email ?? ""} />
            </Field>
            <Field label="GSTIN" error={fe(s, "gstin")}>
              <Input name="gstin" defaultValue={values.gstin ?? ""} className="uppercase" maxLength={15} />
            </Field>
            <Field label="Opens at" required error={fe(s, "openTime")}>
              <Input name="openTime" type="time" defaultValue={values.openTime ?? "10:00"} required />
            </Field>
            <Field label="Closes at" required error={fe(s, "closeTime")}>
              <Input name="closeTime" type="time" defaultValue={values.closeTime ?? "20:00"} required />
            </Field>
          </FormGrid>
          <Field label="Address" error={fe(s, "address")}>
            <Textarea name="address" defaultValue={values.address ?? ""} rows={2} />
          </Field>
          <FormGrid>
            <Field label="Latitude" hint="Optional — for GPS attendance check-in" error={fe(s, "lat")}>
              <Input name="lat" inputMode="decimal" defaultValue={values.lat ?? ""} />
            </Field>
            <Field label="Longitude" error={fe(s, "lng")}>
              <Input name="lng" inputMode="decimal" defaultValue={values.lng ?? ""} />
            </Field>
          </FormGrid>
          <div className="flex justify-end gap-2 pt-1">
            <SubmitButton pendingText="Saving…">{values.id ? "Save changes" : "Create branch"}</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
