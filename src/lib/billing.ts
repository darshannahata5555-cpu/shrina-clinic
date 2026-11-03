import "server-only";
import type { InvoiceStatus } from "@prisma/client";
import { db, type Tx } from "./db";
import { r2, toNum } from "./format";

export { computeInvoice, type LineInput, type ComputedLine, type InvoiceTotals } from "./gst";

/**
 * Recompute paid / credited / balance / status of an invoice from its payments and
 * credit notes. Call after any payment, refund or credit note touching the invoice.
 */
export async function recalcInvoice(invoiceId: string, tx: Tx) {
  const inv = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { payments: true, creditNotes: true },
  });
  const paid = r2(
    inv.payments.reduce((s, p) => s + (p.kind === "REFUND" ? -toNum(p.amount) : toNum(p.amount)), 0),
  );
  const credited = r2(inv.creditNotes.reduce((s, c) => s + toNum(c.amount), 0));
  const balance = r2(Math.max(0, toNum(inv.total) - paid - credited));
  let status: InvoiceStatus = inv.status;
  if (inv.status !== "CANCELLED") {
    status = balance <= 0.009 ? "PAID" : paid > 0 || credited > 0 ? "PARTIAL" : "UNPAID";
  }
  return tx.invoice.update({
    where: { id: invoiceId },
    data: { paidAmount: paid, creditedAmount: credited, balance, status },
  });
}

/**
 * Patient advance (wallet) balance: money received without an invoice, minus
 * amounts applied to invoices with method ADVANCE, minus advance refunds.
 */
export async function advanceBalance(patientId: string, tx?: Tx): Promise<number> {
  const payments = await (tx ?? db).payment.findMany({
    where: { patientId },
    select: { amount: true, method: true, kind: true, invoiceId: true },
  });
  let bal = 0;
  for (const p of payments) {
    const a = toNum(p.amount);
    if (p.kind === "RECEIPT" && !p.invoiceId && p.method !== "ADVANCE") bal += a;
    else if (p.kind === "RECEIPT" && p.method === "ADVANCE") bal -= a;
    else if (p.kind === "REFUND" && !p.invoiceId) bal -= a;
  }
  return r2(bal);
}

/** Lifetime billing summary for a patient. */
export async function patientFinancials(patientId: string) {
  const [agg, advance] = await Promise.all([
    db.invoice.aggregate({
      where: { patientId, deletedAt: null, status: { not: "CANCELLED" } },
      _sum: { total: true, paidAmount: true, balance: true, creditedAmount: true },
      _count: true,
    }),
    advanceBalance(patientId),
  ]);
  return {
    invoices: agg._count,
    billed: toNum(agg._sum.total),
    paid: toNum(agg._sum.paidAmount),
    credited: toNum(agg._sum.creditedAmount),
    outstanding: toNum(agg._sum.balance),
    advance,
  };
}

export const PAYMENT_METHODS = ["CASH", "UPI", "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "ONLINE"] as const;
