"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Field, Input, Select } from "@/components/ui/field";
import { saveUsageAction } from "../../actions";

/** Add a product (and quantity) that is auto-deducted from stock every time a session is done. */
export function UsageForm({ treatmentId, products }: { treatmentId: string; products: { id: string; name: string; unit: string; category: string }[] }) {
  const [productId, setProductId] = useState("");
  const unit = products.find((p) => p.id === productId)?.unit ?? "";
  return (
    <ActionForm action={saveUsageAction} resetOnSuccess onSuccess={() => setProductId("")}>
      {(s) => (
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_140px_auto]">
          <input type="hidden" name="treatmentId" value={treatmentId} />
          <Field label="Product" error={fe(s, "productId")}>
            <Select
              name="productId"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              placeholder="Choose product"
              options={products.map((p) => [p.id, `${p.name} (${p.category}, ${p.unit})`] as const)}
              required
            />
          </Field>
          <Field label={`Quantity per session${unit ? ` (${unit})` : ""}`} error={fe(s, "quantity")}>
            <Input name="quantity" type="number" step="0.01" min="0.01" placeholder="5" required />
          </Field>
          <SubmitButton pendingText="Saving…">Add / update</SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}
