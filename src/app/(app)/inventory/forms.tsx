"use client";

import { useMemo, useState } from "react";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { useDialog } from "@/components/ui/dialog";
import { fmtDate } from "@/lib/format";
import { saveProductAction, saveSupplierAction, stockInAction, stockOutAction, transferStockAction } from "./actions";
import { PRODUCT_CATEGORIES, STOCK_IN_TYPES, STOCK_OUT_TYPES, UNITS } from "./_lib/labels";

type Opt = readonly [string, string];

export type ProductFormValues = {
  id?: string;
  name?: string;
  sku?: string;
  category?: string;
  brand?: string | null;
  unit?: string;
  purchasePrice?: number;
  sellingPrice?: number;
  gstRate?: number;
  hsnCode?: string | null;
  minStock?: number;
  isRetail?: boolean;
  isActive?: boolean;
  supplierId?: string | null;
  description?: string | null;
};

export function ProductForm({ values = {}, suppliers }: { values?: ProductFormValues; suppliers: Opt[] }) {
  const dialog = useDialog();
  const categories = useMemo(() => {
    const list: string[] = [...PRODUCT_CATEGORIES];
    if (values.category && !list.includes(values.category)) list.unshift(values.category);
    return list.map((c) => [c, c] as const);
  }, [values.category]);
  return (
    <ActionForm action={saveProductAction} onSuccess={() => dialog?.close()} resetOnSuccess={!values.id}>
      {(s) => (
        <div className="space-y-4">
          {values.id && <input type="hidden" name="id" value={values.id} />}
          <Field label="Product name" required error={fe(s, "name")}>
            <Input name="name" defaultValue={values.name} placeholder="Hyaluronic Acid Booster Serum" required />
          </Field>
          <FormGrid>
            <Field label="Product ID / SKU" error={fe(s, "sku")} hint={values.id ? undefined : "Leave blank to auto-generate (PRD-0001)"}>
              <Input name="sku" defaultValue={values.sku} className="uppercase" />
            </Field>
            <Field label="Category" required error={fe(s, "category")}>
              <Select name="category" defaultValue={values.category ?? "Consumable"} options={categories} />
            </Field>
            <Field label="Brand" error={fe(s, "brand")}>
              <Input name="brand" defaultValue={values.brand ?? ""} />
            </Field>
            <Field label="Unit" required error={fe(s, "unit")} hint="Stock and treatment usage are counted in this unit">
              <Select name="unit" defaultValue={values.unit ?? "pcs"} options={UNITS} />
            </Field>
            <Field label="Purchase price (₹ per unit)" required error={fe(s, "purchasePrice")}>
              <Input name="purchasePrice" inputMode="decimal" defaultValue={values.purchasePrice ?? ""} required />
            </Field>
            <Field label="Selling price (₹ per unit)" required error={fe(s, "sellingPrice")} hint="Enter 0 for consumables not sold to patients">
              <Input name="sellingPrice" inputMode="decimal" defaultValue={values.sellingPrice ?? 0} required />
            </Field>
            <Field label="GST rate (%)" required error={fe(s, "gstRate")}>
              <Select name="gstRate" defaultValue={String(values.gstRate ?? 18)} options={[["0", "0%"], ["5", "5%"], ["12", "12%"], ["18", "18%"], ["28", "28%"]]} />
            </Field>
            <Field label="HSN code" error={fe(s, "hsnCode")}>
              <Input name="hsnCode" defaultValue={values.hsnCode ?? ""} />
            </Field>
            <Field label="Minimum stock level" required error={fe(s, "minStock")} hint="Low-stock alert at or below this (per branch)">
              <Input name="minStock" inputMode="decimal" defaultValue={values.minStock ?? 0} required />
            </Field>
            <Field label="Supplier" error={fe(s, "supplierId")}>
              <Select name="supplierId" defaultValue={values.supplierId ?? ""} options={suppliers} placeholder="—" />
            </Field>
          </FormGrid>
          <Field label="Description" error={fe(s, "description")}>
            <Textarea name="description" defaultValue={values.description ?? ""} rows={2} />
          </Field>
          <div className="flex flex-wrap gap-5">
            <Checkbox name="isRetail" label="Sold to patients (retail)" defaultChecked={values.isRetail ?? false} />
            <Checkbox name="isActive" label="Active" defaultChecked={values.isActive ?? true} />
          </div>
          <div className="flex justify-end pt-1">
            <SubmitButton pendingText="Saving…">{values.id ? "Save changes" : "Add product"}</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export type BatchOpt = { id: string; branchId: string; batchNo: string; expiryDate: string | null; quantity: number };

function BranchField({ branches, defaultBranchId, error, name = "branchId", label = "Branch" }: { branches: Opt[]; defaultBranchId?: string | null; error?: string; name?: string; label?: string }) {
  if (branches.length <= 1) return branches[0] ? <input type="hidden" name={name} value={branches[0][0]} /> : null;
  return (
    <Field label={label} required error={error}>
      <Select name={name} defaultValue={defaultBranchId ?? branches[0]?.[0]} options={branches} />
    </Field>
  );
}

export function StockInForm({
  productId,
  unit,
  defaultCost,
  branches,
  defaultBranchId,
  suppliers,
  defaultSupplierId,
}: {
  productId: string;
  unit: string;
  defaultCost: number;
  branches: Opt[];
  defaultBranchId?: string | null;
  suppliers: Opt[];
  defaultSupplierId?: string | null;
}) {
  const dialog = useDialog();
  const [type, setType] = useState<string>("PURCHASE");
  return (
    <ActionForm action={stockInAction} onSuccess={() => dialog?.close()} resetOnSuccess>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="productId" value={productId} />
          <FormGrid>
            <Field label="Reason" required error={fe(s, "type")}>
              <Select name="type" value={type} onChange={(e) => setType(e.target.value)} options={STOCK_IN_TYPES} />
            </Field>
            <BranchField branches={branches} defaultBranchId={defaultBranchId} error={fe(s, "branchId")} />
            <Field label={`Quantity (${unit})`} required error={fe(s, "quantity")}>
              <Input name="quantity" inputMode="decimal" required autoFocus />
            </Field>
            <Field label="Unit cost (₹)" error={fe(s, "unitCost")}>
              <Input name="unitCost" inputMode="decimal" defaultValue={defaultCost} />
            </Field>
            <Field label="Batch number" error={fe(s, "batchNo")} hint="Same batch & expiry merges into the existing batch">
              <Input name="batchNo" placeholder="GENERAL" />
            </Field>
            <Field label="Expiry date" error={fe(s, "expiryDate")}>
              <Input name="expiryDate" type="date" />
            </Field>
            {type === "PURCHASE" && (
              <Field label="Supplier" error={fe(s, "supplierId")} className="sm:col-span-2">
                <Select name="supplierId" defaultValue={defaultSupplierId ?? ""} options={suppliers} placeholder="—" />
              </Field>
            )}
          </FormGrid>
          <Field label="Note" required={type !== "PURCHASE"} error={fe(s, "notes")} hint={type === "PURCHASE" ? "For full supplier bills with many items use Purchases → New purchase" : undefined}>
            <Textarea name="notes" rows={2} placeholder={type === "CUSTOMER_RETURN" ? "Invoice number, reason for return" : type === "ADJUSTMENT_IN" ? "Why the count was corrected" : ""} />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">Add to stock</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function StockOutForm({
  productId,
  unit,
  branches,
  defaultBranchId,
  batches,
}: {
  productId: string;
  unit: string;
  branches: Opt[];
  defaultBranchId?: string | null;
  batches: BatchOpt[];
}) {
  const dialog = useDialog();
  const [branchId, setBranchId] = useState<string>(defaultBranchId ?? branches[0]?.[0] ?? "");
  const batchOpts = batches
    .filter((b) => b.branchId === branchId && b.quantity > 0)
    .map((b) => [b.id, `${b.batchNo} · ${b.quantity} ${unit}${b.expiryDate ? ` · exp ${fmtDate(b.expiryDate)}` : ""}`] as const);
  return (
    <ActionForm action={stockOutAction} onSuccess={() => dialog?.close()} resetOnSuccess>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="productId" value={productId} />
          <FormGrid>
            <Field label="Reason" required error={fe(s, "type")}>
              <Select name="type" defaultValue="ADJUSTMENT_OUT" options={STOCK_OUT_TYPES} />
            </Field>
            {branches.length > 1 ? (
              <Field label="Branch" required error={fe(s, "branchId")}>
                <Select name="branchId" value={branchId} onChange={(e) => setBranchId(e.target.value)} options={branches} />
              </Field>
            ) : (
              <input type="hidden" name="branchId" value={branchId} />
            )}
            <Field label={`Quantity (${unit})`} required error={fe(s, "quantity")}>
              <Input name="quantity" inputMode="decimal" required autoFocus />
            </Field>
            <Field label="Batch" error={fe(s, "batchId")} hint="Leave on automatic to use the earliest-expiring stock first">
              <Select name="batchId" defaultValue="" options={batchOpts} placeholder="Automatic (earliest expiry first)" />
            </Field>
          </FormGrid>
          <Field label="Note" required error={fe(s, "notes")}>
            <Textarea name="notes" rows={2} required placeholder="What happened? e.g. bottle broke during handling" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton variant="danger" pendingText="Saving…">Remove from stock</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function TransferForm({
  productId,
  unit,
  fromBranches,
  allBranches,
  defaultBranchId,
  batches,
}: {
  productId: string;
  unit: string;
  fromBranches: Opt[];
  allBranches: Opt[];
  defaultBranchId?: string | null;
  batches: BatchOpt[];
}) {
  const dialog = useDialog();
  const [from, setFrom] = useState<string>(defaultBranchId ?? fromBranches[0]?.[0] ?? "");
  const toOpts = allBranches.filter(([id]) => id !== from);
  const batchOpts = batches
    .filter((b) => b.branchId === from && b.quantity > 0)
    .map((b) => [b.id, `${b.batchNo} · ${b.quantity} ${unit}${b.expiryDate ? ` · exp ${fmtDate(b.expiryDate)}` : ""}`] as const);
  return (
    <ActionForm action={transferStockAction} onSuccess={() => dialog?.close()} resetOnSuccess>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="productId" value={productId} />
          <FormGrid>
            <Field label="From branch" required error={fe(s, "fromBranchId")}>
              <Select name="fromBranchId" value={from} onChange={(e) => setFrom(e.target.value)} options={fromBranches} />
            </Field>
            <Field label="To branch" required error={fe(s, "toBranchId")}>
              <Select name="toBranchId" defaultValue={toOpts[0]?.[0]} key={from} options={toOpts} />
            </Field>
            <Field label={`Quantity (${unit})`} required error={fe(s, "quantity")}>
              <Input name="quantity" inputMode="decimal" required />
            </Field>
            <Field label="Batch" error={fe(s, "batchId")}>
              <Select name="batchId" defaultValue="" options={batchOpts} placeholder="Automatic (earliest expiry first)" />
            </Field>
          </FormGrid>
          <Field label="Note" error={fe(s, "notes")}>
            <Input name="notes" placeholder="e.g. urgent requirement at City Centre" />
          </Field>
          <p className="text-xs text-muted">Batch numbers, expiry dates and costs are carried over to the receiving branch.</p>
          <div className="flex justify-end">
            <SubmitButton pendingText="Transferring…">Transfer stock</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export type SupplierFormValues = {
  id?: string;
  name?: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  address?: string | null;
  notes?: string | null;
  isActive?: boolean;
};

export function SupplierForm({ values = {} }: { values?: SupplierFormValues }) {
  const dialog = useDialog();
  return (
    <ActionForm action={saveSupplierAction} onSuccess={() => dialog?.close()} resetOnSuccess={!values.id}>
      {(s) => (
        <div className="space-y-4">
          {values.id && <input type="hidden" name="id" value={values.id} />}
          <FormGrid>
            <Field label="Supplier name" required error={fe(s, "name")} className="sm:col-span-2">
              <Input name="name" defaultValue={values.name} required />
            </Field>
            <Field label="Contact person" error={fe(s, "contactPerson")}>
              <Input name="contactPerson" defaultValue={values.contactPerson ?? ""} />
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
          </FormGrid>
          <Field label="Address" error={fe(s, "address")}>
            <Textarea name="address" defaultValue={values.address ?? ""} rows={2} />
          </Field>
          <Field label="Notes" error={fe(s, "notes")}>
            <Textarea name="notes" defaultValue={values.notes ?? ""} rows={2} placeholder="Payment terms, delivery days…" />
          </Field>
          <Checkbox name="isActive" label="Active supplier" defaultChecked={values.isActive ?? true} />
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">{values.id ? "Save changes" : "Add supplier"}</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

