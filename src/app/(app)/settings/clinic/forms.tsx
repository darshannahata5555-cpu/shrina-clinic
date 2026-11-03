"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Checkbox, Field, FormGrid, Input, Textarea } from "@/components/ui/field";
import { saveBillingSettingsAction, saveClinicSettingsAction, saveSecuritySettingsAction } from "../actions";
import { computeInvoice } from "@/lib/gst";
import { money } from "@/lib/format";

type Clinic = Record<"clinicName" | "legalName" | "tagline" | "phone" | "email" | "website" | "address" | "gstin" | "state" | "stateCode" | "invoiceFooter" | "terms", string>;

export function ClinicForm({ values }: { values: Clinic }) {
  return (
    <ActionForm action={saveClinicSettingsAction}>
      {(s) => (
        <div className="space-y-4">
          <FormGrid>
            <Field label="Display name" required error={fe(s, "clinicName")}>
              <Input name="clinicName" defaultValue={values.clinicName} required />
            </Field>
            <Field label="Legal / registered name" required hint="Printed on invoices" error={fe(s, "legalName")}>
              <Input name="legalName" defaultValue={values.legalName} required />
            </Field>
            <Field label="Tagline" error={fe(s, "tagline")}>
              <Input name="tagline" defaultValue={values.tagline} />
            </Field>
            <Field label="GSTIN" error={fe(s, "gstin")}>
              <Input name="gstin" defaultValue={values.gstin} maxLength={15} className="uppercase" />
            </Field>
            <Field label="Phone" error={fe(s, "phone")}>
              <Input name="phone" defaultValue={values.phone} />
            </Field>
            <Field label="Email" error={fe(s, "email")}>
              <Input name="email" defaultValue={values.email} />
            </Field>
            <Field label="Website" error={fe(s, "website")}>
              <Input name="website" defaultValue={values.website} />
            </Field>
            <div className="grid grid-cols-[1fr_96px] gap-3">
              <Field label="State (place of supply)" error={fe(s, "state")}>
                <Input name="state" defaultValue={values.state} />
              </Field>
              <Field label="State code" error={fe(s, "stateCode")}>
                <Input name="stateCode" defaultValue={values.stateCode} maxLength={2} />
              </Field>
            </div>
          </FormGrid>
          <Field label="Registered address" error={fe(s, "address")}>
            <Textarea name="address" defaultValue={values.address} rows={2} />
          </Field>
          <Field label="Invoice footer" error={fe(s, "invoiceFooter")}>
            <Input name="invoiceFooter" defaultValue={values.invoiceFooter} />
          </Field>
          <Field label="Terms & conditions (printed on invoices)" error={fe(s, "terms")}>
            <Textarea name="terms" defaultValue={values.terms} rows={3} />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">Save clinic details</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

type Billing = {
  gstEnabled: boolean;
  pricesIncludeGst: boolean;
  roundOff: boolean;
  defaultServiceGst: number;
  defaultProductGst: number;
  serviceSac: string;
  invoicePrefix: string;
  maxDiscountPercentWithoutApproval: number;
};

export function BillingForm({ values, sampleBranchCode, fy }: { values: Billing; sampleBranchCode: string; fy: string }) {
  const [v, setV] = useState(values);
  const preview = computeInvoice(
    [{ kind: "TREATMENT", description: "Hydra Facial", quantity: 1, unitPrice: 4500, discount: 0, gstRate: v.defaultServiceGst }],
    { gstEnabled: v.gstEnabled, pricesIncludeGst: v.pricesIncludeGst, roundOff: v.roundOff },
  );
  const sampleNo = `${v.invoicePrefix ? v.invoicePrefix + "-" : ""}${sampleBranchCode}/${fy}/0001`;
  return (
    <ActionForm action={saveBillingSettingsAction}>
      {(s) => (
        <div className="space-y-4">
          <div className="flex flex-col gap-2.5">
            <Checkbox name="gstEnabled" checked={v.gstEnabled} onChange={(e) => setV({ ...v, gstEnabled: e.target.checked })} label="Charge GST on invoices" />
            <Checkbox name="pricesIncludeGst" checked={v.pricesIncludeGst} onChange={(e) => setV({ ...v, pricesIncludeGst: e.target.checked })} label="Treatment & product prices already include GST" />
            <Checkbox name="roundOff" checked={v.roundOff} onChange={(e) => setV({ ...v, roundOff: e.target.checked })} label="Round invoice total to the nearest rupee" />
          </div>
          <FormGrid>
            <Field label="Default GST on services (%)" error={fe(s, "defaultServiceGst")}>
              <Input name="defaultServiceGst" type="number" step="0.01" value={v.defaultServiceGst} onChange={(e) => setV({ ...v, defaultServiceGst: Number(e.target.value) })} />
            </Field>
            <Field label="Default GST on products (%)" error={fe(s, "defaultProductGst")}>
              <Input name="defaultProductGst" type="number" step="0.01" value={v.defaultProductGst} onChange={(e) => setV({ ...v, defaultProductGst: Number(e.target.value) })} />
            </Field>
            <Field label="SAC code for services" hint="999722 = beauty treatment services" error={fe(s, "serviceSac")}>
              <Input name="serviceSac" defaultValue={v.serviceSac} />
            </Field>
            <Field label="Invoice number prefix" hint={`Next invoice looks like ${sampleNo}`} error={fe(s, "invoicePrefix")}>
              <Input name="invoicePrefix" value={v.invoicePrefix} maxLength={3} className="uppercase" onChange={(e) => setV({ ...v, invoicePrefix: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Max discount without approval (%)" hint="Staff need the refund/approval right to go beyond this" error={fe(s, "maxDiscountPercentWithoutApproval")}>
              <Input name="maxDiscountPercentWithoutApproval" type="number" step="1" defaultValue={v.maxDiscountPercentWithoutApproval} />
            </Field>
          </FormGrid>
          <div className="rounded-lg bg-surface-2 px-4 py-3 text-[13px] text-ink-2">
            <p className="mb-1 font-medium text-ink">Preview — Hydra Facial at ₹4,500</p>
            <p className="tabular">
              Taxable {money(preview.taxableAmount)} · CGST {money(preview.cgst)} · SGST {money(preview.sgst)}
              {preview.roundOff ? ` · Round-off ${money(preview.roundOff)}` : ""} · <span className="font-semibold text-ink">Total {money(preview.total)}</span>
            </p>
          </div>
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">Save GST & invoice settings</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function SecurityForm({ values }: { values: { require2faForOwner: boolean } }) {
  return (
    <ActionForm action={saveSecuritySettingsAction}>
      <div className="space-y-4">
        <Checkbox
          name="require2faForOwner"
          defaultChecked={values.require2faForOwner}
          label="Require two-factor authentication for anyone with user-management access (prompted on next visit)"
        />
        <div className="flex justify-end">
          <SubmitButton pendingText="Saving…">Save security settings</SubmitButton>
        </div>
      </div>
    </ActionForm>
  );
}
