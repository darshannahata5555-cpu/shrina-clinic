"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Checkbox, Field, FormGrid, Input, Select, Textarea, controlClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn, money, r2 } from "@/lib/format";
import { createPurchaseAction } from "../actions";

type ProductOpt = { id: string; name: string; sku: string; unit: string; cost: number; supplierId: string | null };
type Row = { key: number; productId: string; batchNo: string; expiryDate: string; quantity: string; unitCost: string };

let k = 0;
const blank = (): Row => ({ key: ++k, productId: "", batchNo: "", expiryDate: "", quantity: "", unitCost: "" });

export function PurchaseForm({
  products,
  suppliers,
  branches,
  defaultBranchId,
  today,
  canExpense,
}: {
  products: ProductOpt[];
  suppliers: [string, string][];
  branches: [string, string][];
  defaultBranchId: string | null;
  today: string;
  canExpense: boolean;
}) {
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [supplierId, setSupplierId] = useState("");
  const [addExpense, setAddExpense] = useState(canExpense);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const total = r2(rows.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unitCost) || 0), 0));
  const items = rows
    .filter((r) => r.productId)
    .map((r) => ({ productId: r.productId, batchNo: r.batchNo, expiryDate: r.expiryDate, quantity: r.quantity, unitCost: r.unitCost || "0" }));

  // Products from the chosen supplier first.
  const sorted = useMemo(
    () => [...products].sort((a, b) => Number(b.supplierId === supplierId) - Number(a.supplierId === supplierId) || a.name.localeCompare(b.name)),
    [products, supplierId],
  );

  return (
    <ActionForm action={createPurchaseAction} refresh={false}>
      {(s) => (
        <div className="space-y-5">
          <input type="hidden" name="items" value={JSON.stringify(items)} />
          <Card>
            <CardHeader title="Bill details" />
            <CardBody>
              <FormGrid className="lg:grid-cols-4">
                <Field label="Supplier" required error={fe(s, "supplierId")}>
                  <Select name="supplierId" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} options={suppliers} placeholder="Choose supplier" required />
                </Field>
                {branches.length > 1 ? (
                  <Field label="Receiving branch" required error={fe(s, "branchId")}>
                    <Select name="branchId" defaultValue={defaultBranchId ?? branches[0]?.[0]} options={branches} />
                  </Field>
                ) : (
                  <input type="hidden" name="branchId" value={branches[0]?.[0] ?? ""} />
                )}
                <Field label="Supplier bill no." error={fe(s, "billNo")}>
                  <Input name="billNo" placeholder="INV-10234" />
                </Field>
                <Field label="Purchase date" required error={fe(s, "purchaseDate")}>
                  <Input name="purchaseDate" type="date" defaultValue={today} max={today} required />
                </Field>
              </FormGrid>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Items received"
              description="Each line creates (or tops up) a batch in stock"
              actions={
                <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, blank()])}>
                  <Plus className="h-3.5 w-3.5" /> Add line
                </Button>
              }
            />
            <CardBody className="space-y-3">
              {fe(s, "items") && <p className="text-sm text-danger">{fe(s, "items")}</p>}
              {Object.entries(s?.fieldErrors ?? {})
                .filter(([key]) => key.startsWith("items."))
                .slice(0, 1)
                .map(([key, msg]) => (
                  <p key={key} className="text-sm text-danger">
                    Line {Number(key.split(".")[1]) + 1}: {msg}
                  </p>
                ))}
              <div className="hidden grid-cols-[minmax(0,2.4fr)_1fr_1fr_0.8fr_0.9fr_0.9fr_36px] gap-2 text-xs font-medium text-muted lg:grid">
                <span>Product</span>
                <span>Batch no.</span>
                <span>Expiry</span>
                <span>Qty</span>
                <span>Unit cost (₹)</span>
                <span className="text-right">Amount</span>
                <span />
              </div>
              {rows.map((r, i) => {
                const p = byId.get(r.productId);
                const amount = (Number(r.quantity) || 0) * (Number(r.unitCost) || 0);
                return (
                  <div key={r.key} className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 lg:grid-cols-[minmax(0,2.4fr)_1fr_1fr_0.8fr_0.9fr_0.9fr_36px] lg:items-center lg:border-0 lg:p-0">
                    <select
                      aria-label={`Product line ${i + 1}`}
                      className={cn(controlClass, "col-span-2 h-9.5 lg:col-span-1")}
                      value={r.productId}
                      onChange={(e) => {
                        const np = byId.get(e.target.value);
                        update(r.key, { productId: e.target.value, unitCost: r.unitCost || (np ? String(np.cost) : "") });
                      }}
                    >
                      <option value="">Choose product…</option>
                      {sorted.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name} ({o.sku})
                        </option>
                      ))}
                    </select>
                    <Input aria-label="Batch number" placeholder="Batch no." value={r.batchNo} onChange={(e) => update(r.key, { batchNo: e.target.value })} />
                    <Input aria-label="Expiry date" type="date" value={r.expiryDate} onChange={(e) => update(r.key, { expiryDate: e.target.value })} />
                    <div className="relative">
                      <Input aria-label="Quantity" inputMode="decimal" placeholder="Qty" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} className="pr-10" />
                      {p && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted">{p.unit}</span>}
                    </div>
                    <Input aria-label="Unit cost" inputMode="decimal" placeholder="Cost" value={r.unitCost} onChange={(e) => update(r.key, { unitCost: e.target.value })} />
                    <p className="tabular self-center text-right text-sm font-medium">{money(amount)}</p>
                    <button
                      type="button"
                      onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blank()]))}
                      className="col-span-2 justify-self-end rounded-md p-2 text-muted hover:bg-surface-3 hover:text-danger lg:col-span-1"
                      aria-label="Remove line"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
              <div className="flex items-center justify-end gap-3 border-t border-border pt-3">
                <span className="text-sm text-muted">Bill total</span>
                <span className="tabular text-lg font-semibold">{money(total)}</span>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-4">
              <Field label="Notes" error={fe(s, "notes")}>
                <Textarea name="notes" rows={2} placeholder="Delivery remarks, damaged items, etc." />
              </Field>
              {canExpense && (
                <div className="rounded-lg bg-surface-2 p-3">
                  <Checkbox name="addExpense" checked={addExpense} onChange={(e) => setAddExpense(e.target.checked)} label="Also record the bill total as a clinic expense (Product purchases)" />
                  {addExpense && (
                    <div className="mt-3 max-w-xs">
                      <Field label="Paid / payable by">
                        <Select
                          name="expenseMethod"
                          defaultValue="BANK_TRANSFER"
                          options={[["BANK_TRANSFER", "Bank transfer"], ["UPI", "UPI"], ["CASH", "Cash"], ["CREDIT_CARD", "Credit card"], ["DEBIT_CARD", "Debit card"], ["ONLINE", "Online payment"]]}
                        />
                      </Field>
                    </div>
                  )}
                </div>
              )}
              <div className="flex justify-end">
                <SubmitButton pendingText="Saving purchase…" disabled={items.length === 0}>
                  Save purchase & add to stock
                </SubmitButton>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </ActionForm>
  );
}
