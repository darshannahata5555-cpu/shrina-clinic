"use client";

import { useState } from "react";
import { Paperclip } from "lucide-react";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { useDialog } from "@/components/ui/dialog";
import { EXPENSE_CATEGORY_LABEL } from "@/lib/status";
import { cn } from "@/lib/format";
import { rejectExpenseAction, saveActivityAction, saveExpenseAction, updateChecklistAction } from "./actions";
import { ACTIVITY_TYPES, DEFAULT_CHECKLISTS, EXPENSE_METHODS, isChecklist, type ChecklistItem } from "./_lib/labels";

type Opt = readonly [string, string];

export type ExpenseFormValues = {
  id?: string;
  branchId?: string;
  date?: string;
  category?: string;
  amount?: number;
  paidTo?: string;
  method?: string;
  description?: string | null;
  receiptUrl?: string | null;
  status?: string;
  rejectionReason?: string | null;
};

export function ExpenseForm({
  values = {},
  branches,
  defaultBranchId,
  today,
  autoApprove,
}: {
  values?: ExpenseFormValues;
  branches: Opt[];
  defaultBranchId?: string | null;
  today: string;
  autoApprove: boolean;
}) {
  const dialog = useDialog();
  const resubmit = values.status === "REJECTED" && !autoApprove;
  return (
    <ActionForm action={saveExpenseAction} onSuccess={() => dialog?.close()} resetOnSuccess={!values.id}>
      {(s) => (
        <div className="space-y-4">
          {values.id && <input type="hidden" name="id" value={values.id} />}
          {resubmit && values.rejectionReason && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Rejected: {values.rejectionReason}. Saving will resubmit it for approval.</p>
          )}
          <FormGrid>
            <Field label="Amount (₹)" required error={fe(s, "amount")}>
              <Input name="amount" inputMode="decimal" defaultValue={values.amount ?? ""} required autoFocus />
            </Field>
            <Field label="Expense date" required error={fe(s, "date")}>
              <Input name="date" type="date" defaultValue={values.date ?? today} max={today} required />
            </Field>
            <Field label="Category" required error={fe(s, "category")}>
              <Select name="category" defaultValue={values.category ?? ""} placeholder="Choose category" options={Object.entries(EXPENSE_CATEGORY_LABEL)} required />
            </Field>
            <Field label="Payment method" required error={fe(s, "method")}>
              <Select name="method" defaultValue={values.method ?? "UPI"} options={EXPENSE_METHODS} />
            </Field>
            <Field label="Paid to" required error={fe(s, "paidTo")} className={branches.length > 1 ? "" : "sm:col-span-2"}>
              <Input name="paidTo" defaultValue={values.paidTo ?? ""} placeholder="Vendor / person" required />
            </Field>
            {branches.length > 1 ? (
              <Field label="Branch" required error={fe(s, "branchId")}>
                <Select name="branchId" defaultValue={values.branchId ?? defaultBranchId ?? branches[0]?.[0]} options={branches} />
              </Field>
            ) : (
              <input type="hidden" name="branchId" value={branches[0]?.[0] ?? ""} />
            )}
          </FormGrid>
          <Field label="Description" error={fe(s, "description")}>
            <Textarea name="description" defaultValue={values.description ?? ""} rows={2} placeholder="What was this for?" />
          </Field>
          <Field label="Bill / receipt" hint="Photo or PDF, up to 10 MB">
            <input
              type="file"
              name="receipt"
              accept="image/*,application/pdf"
              className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-lg file:border-0 file:bg-surface-3 file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink hover:file:bg-border"
            />
          </Field>
          {values.receiptUrl && (
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <a href={values.receiptUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-accent hover:underline">
                <Paperclip className="h-4 w-4" /> Current receipt
              </a>
              <Checkbox name="removeReceipt" label="Remove it" />
            </div>
          )}
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-muted">{autoApprove ? "Recorded as approved (you are an approver)." : "Goes to the owner for approval."}</p>
            <SubmitButton pendingText="Saving…">{values.id ? (resubmit ? "Save & resubmit" : "Save changes") : autoApprove ? "Record expense" : "Submit for approval"}</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function RejectExpenseForm({ id }: { id: string }) {
  const dialog = useDialog();
  return (
    <ActionForm action={rejectExpenseAction} onSuccess={() => dialog?.close()}>
      {(s) => (
        <div className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <Field label="Reason for rejection" required error={fe(s, "reason")} hint="The person who submitted it will see this.">
            <Textarea name="reason" rows={3} required autoFocus placeholder="e.g. Covered under warranty — raise with vendor" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton variant="danger" pendingText="Rejecting…">
              Reject expense
            </SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export type ActivityFormValues = {
  id?: string;
  branchId?: string;
  type?: string;
  title?: string;
  description?: string | null;
  date?: string;
  checklist?: ChecklistItem[];
};

export function ActivityForm({
  values = {},
  branches,
  defaultBranchId,
  now,
}: {
  values?: ActivityFormValues;
  branches: Opt[];
  defaultBranchId?: string | null;
  now: string;
}) {
  const dialog = useDialog();
  const [type, setType] = useState(values.type ?? "GENERAL");
  const items: ChecklistItem[] = values.checklist?.length
    ? values.checklist
    : isChecklist(type)
      ? DEFAULT_CHECKLISTS[type].map((label) => ({ label, done: false }))
      : [];
  return (
    <ActionForm action={saveActivityAction} onSuccess={() => dialog?.close()} resetOnSuccess={!values.id}>
      {(s) => (
        <div className="space-y-4">
          {values.id && <input type="hidden" name="id" value={values.id} />}
          <FormGrid>
            <Field label="Activity type" required error={fe(s, "type")}>
              <Select name="type" value={type} onChange={(e) => setType(e.target.value)} options={ACTIVITY_TYPES} />
            </Field>
            <Field label="Date & time" required error={fe(s, "date")}>
              <Input name="date" type="datetime-local" defaultValue={values.date ?? now} required />
            </Field>
            <Field label="Title" error={fe(s, "title")} className={branches.length > 1 ? "" : "sm:col-span-2"}>
              <Input
                name="title"
                defaultValue={values.title ?? ""}
                placeholder={
                  type === "PATIENT_COMPLAINT"
                    ? "e.g. Long wait before session"
                    : type === "MACHINE_MAINTENANCE"
                      ? "e.g. Diode laser quarterly service"
                      : type === "EQUIPMENT_REPAIR"
                        ? "e.g. Treatment chair not lifting"
                        : "Leave blank to use the activity type"
                }
              />
            </Field>
            {branches.length > 1 ? (
              <Field label="Branch" required error={fe(s, "branchId")}>
                <Select name="branchId" defaultValue={values.branchId ?? defaultBranchId ?? branches[0]?.[0]} options={branches} />
              </Field>
            ) : (
              <input type="hidden" name="branchId" value={branches[0]?.[0] ?? ""} />
            )}
          </FormGrid>
          <Field label={type === "PATIENT_COMPLAINT" ? "What happened & action taken" : "Details"} error={fe(s, "description")}>
            <Textarea name="description" defaultValue={values.description ?? ""} rows={3} />
          </Field>
          {isChecklist(type) && (
            <div key={type} className="rounded-lg border border-border p-3">
              <p className="mb-2 text-[13px] font-medium text-ink-2">Checklist</p>
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={`${type}-${i}`}>
                    <input type="hidden" name="label" value={it.label} />
                    <Checkbox name="done" value={String(i)} defaultChecked={it.done} label={it.label} />
                  </div>
                ))}
              </div>
              <Field label="Extra items (one per line)" className="mt-3">
                <Textarea name="extraItems" rows={2} placeholder="Optional" />
              </Field>
            </div>
          )}
          <div className="flex justify-end">
            <SubmitButton pendingText="Saving…">{values.id ? "Save changes" : "Record activity"}</SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function ChecklistForm({ id, items, description, locked }: { id: string; items: ChecklistItem[]; description?: string | null; locked?: boolean }) {
  const dialog = useDialog();
  const [checked, setChecked] = useState<boolean[]>(items.map((i) => i.done));
  const done = checked.filter(Boolean).length;
  return (
    <ActionForm action={updateChecklistAction} onSuccess={() => dialog?.close()}>
      {() => (
        <div className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-success transition-all" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
          </div>
          <p className="text-[13px] text-muted">
            {done} of {items.length} done
          </p>
          <ul className="space-y-1">
            {items.map((it, i) => (
              <li key={i}>
                <label className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-surface-2", checked[i] ? "text-muted line-through" : "text-ink")}>
                  <input
                    type="checkbox"
                    name="done"
                    value={String(i)}
                    checked={checked[i]}
                    disabled={locked}
                    onChange={(e) => setChecked((c) => c.map((v, j) => (j === i ? e.target.checked : v)))}
                    className="h-4.5 w-4.5 accent-[var(--success)]"
                  />
                  {it.label}
                </label>
              </li>
            ))}
          </ul>
          {!locked && (
            <>
              <Field label="Add items (one per line)">
                <Textarea name="extraItems" rows={2} placeholder="Optional" />
              </Field>
              <Field label="Remarks">
                <Textarea name="description" rows={2} defaultValue={description ?? ""} placeholder="Anything the manager should know" />
              </Field>
              <div className="flex justify-end">
                <SubmitButton pendingText="Saving…">Save checklist</SubmitButton>
              </div>
            </>
          )}
          {locked && <p className="text-sm text-muted">This checklist was reviewed and is locked.</p>}
        </div>
      )}
    </ActionForm>
  );
}
