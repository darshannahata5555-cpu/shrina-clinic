import "server-only";
import type { Prisma } from "@prisma/client";
import { fromIst, istDateKey, addDaysKey } from "@/lib/format";

export type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export const INVOICE_STATUS_FILTER = [
  ["due", "Payment due"],
  ["UNPAID", "Unpaid"],
  ["PARTIAL", "Partially paid"],
  ["PAID", "Paid"],
  ["CANCELLED", "Cancelled"],
] as const;

/** Build the Prisma `where` for the invoice list / export from URL params, within the user's branch scope. */
export function invoiceWhere(sp: SP, scopeIds: string[]): Prisma.InvoiceWhereInput {
  const q = one(sp.q).trim();
  const status = one(sp.status);
  const method = one(sp.method);
  const from = one(sp.from);
  const to = one(sp.to);
  const branch = one(sp.branch);
  const ids = branch && scopeIds.includes(branch) ? [branch] : scopeIds;
  const where: Prisma.InvoiceWhereInput = { deletedAt: null, branchId: { in: ids } };
  if (status === "due") where.status = { in: ["UNPAID", "PARTIAL"] };
  else if (["UNPAID", "PARTIAL", "PAID", "CANCELLED"].includes(status)) where.status = status as Prisma.EnumInvoiceStatusFilter["equals"];
  if (method) where.payments = { some: { method: method as never, kind: "RECEIPT" } };
  if (/^\d{4}-\d{2}-\d{2}$/.test(from) || /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    where.date = {
      ...(/^\d{4}-\d{2}-\d{2}$/.test(from) ? { gte: fromIst(from) } : {}),
      ...(/^\d{4}-\d{2}-\d{2}$/.test(to) ? { lt: fromIst(addDaysKey(to, 1)) } : {}),
    };
  }
  if (q) {
    const digits = q.replace(/\D/g, "");
    where.OR = [
      { number: { contains: q, mode: "insensitive" } },
      { patient: { fullName: { contains: q, mode: "insensitive" } } },
      { patient: { code: { contains: q, mode: "insensitive" } } },
      ...(digits.length >= 4 ? [{ patient: { mobile: { contains: digits } } }] : []),
    ];
  }
  return where;
}

export function paymentWhere(sp: SP, scopeIds: string[]): Prisma.PaymentWhereInput {
  const q = one(sp.q).trim();
  const method = one(sp.method);
  const kind = one(sp.kind);
  const from = one(sp.from);
  const to = one(sp.to);
  const branch = one(sp.branch);
  const ids = branch && scopeIds.includes(branch) ? [branch] : scopeIds;
  const where: Prisma.PaymentWhereInput = { branchId: { in: ids } };
  if (method) where.method = method as never;
  if (kind === "RECEIPT" || kind === "REFUND") where.kind = kind;
  if (kind === "ADVANCE") Object.assign(where, { kind: "RECEIPT", invoiceId: null, method: { not: "ADVANCE" } });
  const dateOk = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (dateOk(from) || dateOk(to)) {
    where.paidAt = { ...(dateOk(from) ? { gte: fromIst(from) } : {}), ...(dateOk(to) ? { lt: fromIst(addDaysKey(to, 1)) } : {}) };
  }
  if (q) {
    const digits = q.replace(/\D/g, "");
    where.OR = [
      { receiptNo: { contains: q, mode: "insensitive" } },
      { reference: { contains: q, mode: "insensitive" } },
      { patient: { fullName: { contains: q, mode: "insensitive" } } },
      { patient: { code: { contains: q, mode: "insensitive" } } },
      { invoice: { number: { contains: q, mode: "insensitive" } } },
      ...(digits.length >= 4 ? [{ patient: { mobile: { contains: digits } } }] : []),
    ];
  }
  return where;
}

export const todayKey = () => istDateKey();
export { one };
