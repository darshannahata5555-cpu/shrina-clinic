"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { ActionForm, SubmitButton, fe } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { Card, CardBody } from "@/components/ui/card";
import { PatientPicker, type PickedPatient } from "@/components/pickers/patient-picker";
import { cn, fmtDate, money } from "@/lib/format";
import { PAYMENT_METHOD_LABEL } from "@/lib/status";
import { recordPaymentAction } from "../actions";

type Ctx = { advance: number; openInvoices: { id: string; number: string; date: string; total: number; balance: number }[] };
const METHODS = ["UPI", "CASH", "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "ONLINE"] as const;

export function PaymentForm({
  patient: initial,
  branches,
  defaultBranchId,
  today,
  canRefund,
  defaultInvoiceId,
}: {
  patient: PickedPatient | null;
  branches: { id: string; name: string }[];
  defaultBranchId: string;
  today: string;
  canRefund: boolean;
  defaultInvoiceId?: string | null;
}) {
  const [patient, setPatient] = useState<PickedPatient | null>(initial);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [mode, setMode] = useState<"ADVANCE" | "INVOICE" | "REFUND_ADVANCE">(defaultInvoiceId ? "INVOICE" : "ADVANCE");
  const [invoiceId, setInvoiceId] = useState(defaultInvoiceId ?? "");
  const [method, setMethod] = useState("UPI");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    setCtx(null);
    if (!patient) return;
    let alive = true;
    fetch(`/api/billing/patient-context?patientId=${patient.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Ctx | null) => {
        if (!alive || !d) return;
        setCtx(d);
        if (mode === "INVOICE") {
          const target = d.openInvoices.find((i) => i.id === invoiceId) ?? d.openInvoices[0];
          if (target) (setInvoiceId(target.id), setAmount(String(target.balance)));
          else setInvoiceId("");
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient]);

  const inv = ctx?.openInvoices.find((i) => i.id === invoiceId);
  type Mode = "ADVANCE" | "INVOICE" | "REFUND_ADVANCE";
  const modes: [Mode, string, string][] = [
    ["ADVANCE", "Advance / on account", "Money kept against future treatments"],
    ["INVOICE", "Against an invoice", ctx ? `${ctx.openInvoices.length} open invoice${ctx.openInvoices.length === 1 ? "" : "s"}` : "Pay an outstanding bill"],
    ...(canRefund ? ([["REFUND_ADVANCE", "Refund advance", "Return unused advance money"]] as [Mode, string, string][]) : []),
  ];

  return (
    <ActionForm action={recordPaymentAction} refresh={false}>
      {(s) => (
        <Card>
          <CardBody className="space-y-5">
            <input type="hidden" name="mode" value={mode} />
            <Field label="Patient" required error={fe(s, "patientId")}>
              <PatientPicker defaultValue={initial} onChange={setPatient} required />
            </Field>
            {ctx && (
              <p className="flex items-center gap-2 text-[13px] text-ink-2">
                <Wallet className="h-4 w-4 text-success" /> Advance balance <span className="tabular font-medium text-ink">{money(ctx.advance)}</span>
                {ctx.openInvoices.length > 0 && (
                  <>
                    · Outstanding <span className="tabular font-medium text-warning">{money(ctx.openInvoices.reduce((a, i) => a + i.balance, 0))}</span>
                  </>
                )}
              </p>
            )}

            <div className={cn("grid gap-2", modes.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
              {modes.map(([m, title, sub]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    if (m === "INVOICE" && ctx?.openInvoices[0] && !inv) (setInvoiceId(ctx.openInvoices[0].id), setAmount(String(ctx.openInvoices[0].balance)));
                    if (m === "REFUND_ADVANCE" && ctx) setAmount(String(ctx.advance));
                  }}
                  className={cn("rounded-xl border p-3 text-left transition-colors", mode === m ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2")}
                >
                  <p className="text-sm font-medium text-ink">{title}</p>
                  <p className="mt-0.5 text-xs text-muted">{sub}</p>
                </button>
              ))}
            </div>

            {mode === "INVOICE" && (
              <Field label="Invoice" required error={fe(s, "invoiceId")}>
                {ctx && ctx.openInvoices.length === 0 ? (
                  <p className="text-sm text-muted">No unpaid invoices for this patient.</p>
                ) : (
                  <Select
                    name="invoiceId"
                    value={invoiceId}
                    onChange={(e) => {
                      setInvoiceId(e.target.value);
                      const i = ctx?.openInvoices.find((x) => x.id === e.target.value);
                      if (i) setAmount(String(i.balance));
                    }}
                    placeholder={patient ? "Choose invoice…" : "Pick a patient first"}
                    options={(ctx?.openInvoices ?? []).map((i) => [i.id, `${i.number} · ${fmtDate(i.date)} · due ${money(i.balance)}`] as const)}
                  />
                )}
              </Field>
            )}
            {mode !== "INVOICE" && branches.length > 1 && (
              <Field label="Branch" error={fe(s, "branchId")}>
                <Select name="branchId" defaultValue={defaultBranchId} options={branches.map((b) => [b.id, b.name] as const)} />
              </Field>
            )}
            {mode !== "INVOICE" && branches.length <= 1 && <input type="hidden" name="branchId" value={defaultBranchId} />}

            <FormGrid>
              <Field label={mode === "REFUND_ADVANCE" ? "Refund amount (₹)" : "Amount (₹)"} required error={fe(s, "amount")} hint={inv ? `Balance due ${money(inv.balance)}` : mode === "REFUND_ADVANCE" && ctx ? `Up to ${money(ctx.advance)}` : undefined}>
                <Input name="amount" type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </Field>
              <Field label={mode === "REFUND_ADVANCE" ? "Refund by" : "Method"} required error={fe(s, "method")}>
                <Select name="method" value={method} onChange={(e) => setMethod(e.target.value)} options={METHODS.map((m) => [m, PAYMENT_METHOD_LABEL[m]!] as const)} />
              </Field>
              <Field label="Reference" error={fe(s, "reference")} hint={method === "CASH" ? "Optional for cash" : "UTR / card last 4 / transaction id"}>
                <Input name="reference" />
              </Field>
              <Field label="Date" error={fe(s, "paidOn")}>
                <Input name="paidOn" type="date" defaultValue={today} max={today} />
              </Field>
            </FormGrid>
            <Field label="Note" error={fe(s, "notes")}>
              <Textarea name="notes" rows={2} placeholder={mode === "ADVANCE" ? "e.g. Advance for Rejuran course" : ""} />
            </Field>
            <div className="flex justify-end">
              <SubmitButton variant={mode === "REFUND_ADVANCE" ? "danger" : "primary"} pendingText="Saving…" disabled={!patient || (mode === "INVOICE" && !invoiceId)}>
                {mode === "REFUND_ADVANCE" ? "Refund advance" : `Receive ${Number(amount) > 0 ? money(Number(amount)) : "payment"}`}
              </SubmitButton>
            </div>
          </CardBody>
        </Card>
      )}
    </ActionForm>
  );
}
