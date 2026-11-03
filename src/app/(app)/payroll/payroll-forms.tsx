"use client";

import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Checkbox, Field, FormGrid, Input, Select } from "@/components/ui/field";
import { useDialog } from "@/components/ui/dialog";
import { addAdjustmentAction, markPaidAction } from "./actions";

export function AdjustmentForm({ month, staff, staffId }: { month: string; staff: { id: string; label: string }[]; staffId?: string }) {
  const dialog = useDialog();
  return (
    <ActionForm action={addAdjustmentAction} onSuccess={() => dialog?.close()} resetOnSuccess>
      {(s) => (
        <div className="space-y-4">
          <Field label="Employee" required error={fe(s, "staffId")}>
            <Select name="staffId" defaultValue={staffId ?? ""} placeholder="Choose employee…" options={staff.map((x) => [x.id, x.label] as const)} required />
          </Field>
          <FormGrid>
            <Field label="Type" required error={fe(s, "type")}>
              <Select
                name="type"
                defaultValue="INCENTIVE"
                options={[
                  ["INCENTIVE", "Incentive (adds)"],
                  ["BONUS", "Bonus (adds)"],
                  ["ADVANCE", "Salary advance recovery (deducts)"],
                  ["DEDUCTION", "Other deduction (deducts)"],
                ]}
              />
            </Field>
            <Field label="Payroll month" required error={fe(s, "month")}>
              <Input name="month" type="month" defaultValue={month} required />
            </Field>
            <Field label="Amount (₹)" required error={fe(s, "amount")}>
              <Input name="amount" inputMode="decimal" required />
            </Field>
            <Field label="Note" required error={fe(s, "note")}>
              <Input name="note" placeholder="e.g. Package sales incentive" required />
            </Field>
          </FormGrid>
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">Add adjustment</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function MarkPaidForm({ id, today, amount }: { id: string; today: string; amount: string }) {
  const dialog = useDialog();
  return (
    <ActionForm action={markPaidAction} onSuccess={() => dialog?.close()}>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-sm">
            Net pay <span className="tabular font-semibold">{amount}</span>
          </p>
          <FormGrid>
            <Field label="Paid by" required error={fe(s, "method")}>
              <Select
                name="method"
                defaultValue="BANK_TRANSFER"
                options={[
                  ["BANK_TRANSFER", "Bank transfer"],
                  ["UPI", "UPI"],
                  ["CASH", "Cash"],
                ]}
              />
            </Field>
            <Field label="Payment date" required error={fe(s, "paidOn")}>
              <Input name="paidOn" type="date" defaultValue={today} max={today} required />
            </Field>
          </FormGrid>
          <Field label="Reference (UTR / cheque no.)" error={fe(s, "paymentRef")}>
            <Input name="paymentRef" />
          </Field>
          <Checkbox name="recordExpense" defaultChecked label="Also record in Expenses as “Staff salaries”" />
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">Mark as paid</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
