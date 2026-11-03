import "server-only";
import type { PaymentMethod } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { ActionError } from "@/lib/auth";
import { advanceBalance, recalcInvoice } from "@/lib/billing";
import { nextReceiptNumber } from "@/lib/sequence";
import { audit } from "@/lib/audit";
import { money, r2, toNum } from "@/lib/format";
import { PAYMENT_METHOD_LABEL } from "@/lib/status";

/**
 * Collect money against an invoice (or as an advance when `invoiceId` is null) inside a transaction.
 * Enforces: amount > 0, cannot exceed the invoice balance, ADVANCE method needs enough advance balance.
 */
export async function collectPayment(
  tx: Tx,
  input: {
    patientId: string;
    branchId: string;
    invoiceId: string | null;
    amount: number;
    method: PaymentMethod;
    reference?: string | null;
    notes?: string | null;
    paidAt?: Date;
    userId: string;
    skipBalanceCheck?: boolean;
  },
) {
  const amount = r2(input.amount);
  if (!(amount > 0)) throw new ActionError("Amount must be greater than zero.");
  const branch = await tx.branch.findUniqueOrThrow({ where: { id: input.branchId }, select: { code: true } });

  let invoiceNo: string | null = null;
  if (input.invoiceId) {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: input.invoiceId } });
    if (inv.status === "CANCELLED") throw new ActionError("This invoice is cancelled.");
    if (inv.patientId !== input.patientId) throw new ActionError("Invoice belongs to a different patient.");
    if (!input.skipBalanceCheck && amount > toNum(inv.balance) + 0.009)
      throw new ActionError(`Amount ${money(amount)} is more than the balance due (${money(inv.balance)}). Record the extra as an advance from Payments.`);
    invoiceNo = inv.number;
  } else if (input.method === "ADVANCE") {
    throw new ActionError("An advance cannot be paid from the advance balance.");
  }

  if (input.method === "ADVANCE") {
    const available = await advanceBalance(input.patientId, tx);
    if (amount > available + 0.009) throw new ActionError(`Only ${money(available)} is available in the patient's advance balance.`);
  }

  const payment = await tx.payment.create({
    data: {
      receiptNo: await nextReceiptNumber(branch.code, tx),
      kind: "RECEIPT",
      invoiceId: input.invoiceId,
      patientId: input.patientId,
      branchId: input.branchId,
      amount,
      method: input.method,
      reference: input.reference || null,
      notes: input.notes || null,
      paidAt: input.paidAt ?? new Date(),
      receivedById: input.userId,
    },
  });
  if (input.invoiceId) await recalcInvoice(input.invoiceId, tx);

  await audit(
    input.userId,
    "PAYMENT",
    "Payment",
    payment.id,
    input.invoiceId
      ? `Received ${money(amount)} by ${PAYMENT_METHOD_LABEL[input.method]} against invoice ${invoiceNo} (receipt ${payment.receiptNo})`
      : `Received advance ${money(amount)} by ${PAYMENT_METHOD_LABEL[input.method]} (receipt ${payment.receiptNo})`,
    { branchId: input.branchId, tx, changes: { invoiceId: input.invoiceId, amount, method: input.method, reference: input.reference ?? null } },
  );
  return payment;
}
