"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ActionError, assertPermission, can } from "@/lib/auth";
import { assertBranchAccess, resolveWriteBranch } from "@/lib/branch";
import { formObject, handle, parse, zf, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { advanceBalance } from "@/lib/billing";
import { nextReceiptNumber } from "@/lib/sequence";
import { fromIst, istDateKey, money, r2 } from "@/lib/format";
import { PAYMENT_METHOD_LABEL } from "@/lib/status";
import { collectPayment } from "../billing/_lib/money";

const CASH_METHODS = ["CASH", "UPI", "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "ONLINE"] as const;

const Schema = z.object({
  mode: zf.enumOf(["ADVANCE", "INVOICE", "REFUND_ADVANCE"] as const, "Payment type"),
  patientId: zf.id("Patient"),
  invoiceId: zf.optId(),
  branchId: zf.optId(),
  method: zf.enumOf(CASH_METHODS, "Payment method"),
  amount: zf.num("Amount").pipe(z.number().positive("Amount must be more than 0")),
  reference: zf.optText(),
  notes: zf.optText(),
  paidOn: zf.optDate(),
});

/**
 * Payments desk:
 *  - ADVANCE: money received with no invoice → patient's advance balance (used later on invoices).
 *  - INVOICE: payment against one of the patient's open invoices.
 *  - REFUND_ADVANCE: return unused advance money (needs billing.refund).
 */
export async function recordPaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let paymentId = "";
  const res = await handle(async () => {
    const d = parse(Schema, formObject(fd));
    const user = await assertPermission(d.mode === "REFUND_ADVANCE" ? "billing.refund" : "billing.create");
    const patient = await db.patient.findFirst({ where: { id: d.patientId, deletedAt: null }, select: { id: true, fullName: true } });
    if (!patient) throw new ActionError("Patient not found.");
    const today = istDateKey();
    if (d.paidOn && istDateKey(d.paidOn) > today) throw new ActionError("Payment date cannot be in the future.");
    const paidAt = !d.paidOn || istDateKey(d.paidOn) === today ? new Date() : fromIst(istDateKey(d.paidOn), "12:00");

    if (d.mode === "INVOICE") {
      if (!d.invoiceId) throw new ActionError("Choose the invoice this payment is for.");
      const inv = await db.invoice.findFirst({ where: { id: d.invoiceId, deletedAt: null } });
      if (!inv) throw new ActionError("Invoice not found.");
      await assertBranchAccess(user, inv.branchId);
      const p = await db.$transaction((tx) =>
        collectPayment(tx, { patientId: patient.id, branchId: inv.branchId, invoiceId: inv.id, amount: d.amount, method: d.method, reference: d.reference, notes: d.notes, paidAt, userId: user.id }),
      );
      paymentId = p.id;
      return;
    }

    const branchId = await resolveWriteBranch(d.branchId);
    if (d.mode === "ADVANCE") {
      const p = await db.$transaction((tx) =>
        collectPayment(tx, { patientId: patient.id, branchId, invoiceId: null, amount: d.amount, method: d.method, reference: d.reference, notes: d.notes, paidAt, userId: user.id }),
      );
      paymentId = p.id;
      return;
    }

    // REFUND_ADVANCE
    if (!can(user, "billing.refund")) throw new ActionError("You don't have permission to refund.");
    const amount = r2(d.amount);
    const p = await db.$transaction(async (tx) => {
      const available = await advanceBalance(patient.id, tx);
      if (amount > available + 0.009) throw new ActionError(`Only ${money(available)} of advance is available to refund.`);
      const branch = await tx.branch.findUniqueOrThrow({ where: { id: branchId }, select: { code: true } });
      const pay = await tx.payment.create({
        data: {
          receiptNo: await nextReceiptNumber(branch.code, tx),
          kind: "REFUND",
          patientId: patient.id,
          branchId,
          amount,
          method: d.method,
          reference: d.reference,
          notes: d.notes ?? "Advance refund",
          paidAt,
          receivedById: user.id,
        },
      });
      await audit(user.id, "REFUND", "Payment", pay.id, `Refunded advance ${money(amount)} by ${PAYMENT_METHOD_LABEL[d.method]} to ${patient.fullName} (${pay.receiptNo})`, { branchId, tx });
      return pay;
    });
    paymentId = p.id;
  });
  if (res && !res.ok) return res;
  redirect(`/payments?created=${paymentId}`);
}
