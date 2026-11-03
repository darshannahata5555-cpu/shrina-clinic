"use client";

import { useState } from "react";
import { Ban, CreditCard, ReceiptText, Undo2, Wallet } from "lucide-react";
import { Dialog, useDialog } from "@/components/ui/dialog";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { money } from "@/lib/format";
import { PAYMENT_METHOD_LABEL } from "@/lib/status";
import { applyAdvanceAction, cancelInvoiceAction, creditNoteAction, recordInvoicePaymentAction } from "../actions";

const METHODS = ["UPI", "CASH", "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "ONLINE"] as const;
const methodOptions = METHODS.map((m) => [m, PAYMENT_METHOD_LABEL[m]!] as const);

function Close({ children }: { children: (close: () => void) => React.ReactNode }) {
  const d = useDialog();
  return <>{children(() => d?.close())}</>;
}

export function RecordPaymentDialog({ invoiceId, balance }: { invoiceId: string; balance: number }) {
  const [method, setMethod] = useState("UPI");
  return (
    <Dialog title="Record payment" description={`Balance due ${money(balance)}`} trigger={<Button><CreditCard className="h-4 w-4" /> Record payment</Button>}>
      <Close>
        {(close) => (
          <ActionForm action={recordInvoicePaymentAction} onSuccess={close} resetOnSuccess>
            {(s) => (
              <div className="space-y-4">
                <input type="hidden" name="invoiceId" value={invoiceId} />
                <FormGrid>
                  <Field label="Amount (₹)" required error={fe(s, "amount")} hint="Partial payments are fine">
                    <Input name="amount" type="number" min={0.01} max={balance} step="0.01" defaultValue={balance} required />
                  </Field>
                  <Field label="Method" required error={fe(s, "method")}>
                    <Select name="method" value={method} onChange={(e) => setMethod(e.target.value)} options={methodOptions} />
                  </Field>
                </FormGrid>
                {method !== "CASH" && (
                  <Field label="Reference" error={fe(s, "reference")} hint="UPI UTR, card last 4 digits or bank reference">
                    <Input name="reference" />
                  </Field>
                )}
                <Field label="Note" error={fe(s, "notes")}>
                  <Input name="notes" />
                </Field>
                <div className="flex justify-end">
                  <SubmitButton pendingText="Saving…">Record payment</SubmitButton>
                </div>
              </div>
            )}
          </ActionForm>
        )}
      </Close>
    </Dialog>
  );
}

export function ApplyAdvanceDialog({ invoiceId, balance, advance }: { invoiceId: string; balance: number; advance: number }) {
  const max = Math.min(balance, advance);
  return (
    <Dialog title="Adjust from advance" description={`Advance available ${money(advance)} · balance due ${money(balance)}`} size="sm" trigger={<Button variant="outline"><Wallet className="h-4 w-4" /> Use advance</Button>}>
      <Close>
        {(close) => (
          <ActionForm action={applyAdvanceAction} onSuccess={close}>
            {(s) => (
              <div className="space-y-4">
                <input type="hidden" name="invoiceId" value={invoiceId} />
                <Field label="Amount to adjust (₹)" required error={fe(s, "amount")}>
                  <Input name="amount" type="number" min={0.01} max={max} step="0.01" defaultValue={max} required />
                </Field>
                <div className="flex justify-end">
                  <SubmitButton pendingText="Adjusting…">Adjust {money(max)}</SubmitButton>
                </div>
              </div>
            )}
          </ActionForm>
        )}
      </Close>
    </Dialog>
  );
}

export function CreditNoteDialog({ invoiceId, balance, paid, creditable }: { invoiceId: string; balance: number; paid: number; creditable: number }) {
  const [mode, setMode] = useState<"REFUND" | "REDUCE">(paid > 0 ? "REFUND" : "REDUCE");
  const max = Math.min(creditable, mode === "REFUND" ? paid : balance);
  return (
    <Dialog title="Credit note / refund" description="A credit note is issued in both cases and recorded against this invoice." trigger={<Button variant="outline"><Undo2 className="h-4 w-4" /> Credit note / refund</Button>}>
      <Close>
        {(close) => (
          <ActionForm action={creditNoteAction} onSuccess={close} resetOnSuccess>
            {(s) => (
              <div className="space-y-4">
                <input type="hidden" name="invoiceId" value={invoiceId} />
                <input type="hidden" name="mode" value={mode} />
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      ["REFUND", "Refund money paid", `Return up to ${money(Math.min(paid, creditable))} to the patient`, paid <= 0],
                      ["REDUCE", "Reduce amount due", `Write off up to ${money(Math.min(balance, creditable))} of the balance`, balance <= 0],
                    ] as const
                  ).map(([m, title, sub, disabled]) => (
                    <button
                      key={m}
                      type="button"
                      disabled={disabled}
                      onClick={() => setMode(m)}
                      className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-40 ${mode === m ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2"}`}
                    >
                      <p className="text-sm font-medium text-ink">{title}</p>
                      <p className="mt-0.5 text-xs text-muted">{sub}</p>
                    </button>
                  ))}
                </div>
                <FormGrid>
                  <Field label="Amount (₹)" required error={fe(s, "amount")}>
                    <Input key={mode} name="amount" type="number" min={0.01} max={max} step="0.01" defaultValue={max > 0 ? max : ""} required />
                  </Field>
                  {mode === "REFUND" && (
                    <Field label="Refund by" required error={fe(s, "refundMethod")}>
                      <Select name="refundMethod" defaultValue="UPI" options={methodOptions} />
                    </Field>
                  )}
                </FormGrid>
                {mode === "REFUND" && (
                  <Field label="Refund reference" error={fe(s, "reference")}>
                    <Input name="reference" placeholder="UTR / transaction id" />
                  </Field>
                )}
                <Field label="Reason" required error={fe(s, "reason")}>
                  <Textarea name="reason" rows={2} placeholder="e.g. Session not availed — patient relocating" required />
                </Field>
                <div className="flex justify-end">
                  <SubmitButton variant="danger" pendingText="Issuing…" disabled={max <= 0}>
                    <ReceiptText className="h-4 w-4" /> Issue credit note
                  </SubmitButton>
                </div>
              </div>
            )}
          </ActionForm>
        )}
      </Close>
    </Dialog>
  );
}

export function CancelInvoiceDialog({ invoiceId, number, blocked }: { invoiceId: string; number: string; blocked: string | null }) {
  return (
    <Dialog title={`Cancel invoice ${number}`} size="sm" trigger={<Button variant="ghost" className="text-danger"><Ban className="h-4 w-4" /> Cancel invoice</Button>}>
      <Close>
        {(close) =>
          blocked ? (
            <p className="text-sm text-ink-2">{blocked}</p>
          ) : (
            <ActionForm action={cancelInvoiceAction} onSuccess={close}>
              {(s) => (
                <div className="space-y-4">
                  <input type="hidden" name="invoiceId" value={invoiceId} />
                  <p className="text-sm text-ink-2">
                    Products on this invoice go back into stock and any package sold on it is cancelled. The invoice number stays in the series (marked cancelled).
                  </p>
                  <Field label="Reason" required error={fe(s, "reason")}>
                    <Textarea name="reason" rows={2} required placeholder="e.g. Billed to wrong patient" />
                  </Field>
                  <div className="flex justify-end">
                    <SubmitButton variant="danger" pendingText="Cancelling…">Cancel invoice</SubmitButton>
                  </div>
                </div>
              )}
            </ActionForm>
          )
        }
      </Close>
    </Dialog>
  );
}
