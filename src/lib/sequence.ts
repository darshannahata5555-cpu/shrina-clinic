import "server-only";
import { db, type Tx } from "./db";
import { financialYear } from "./format";
import { getSetting } from "./settings";

/** Atomically increment and return the next value of a named counter. */
export async function nextSeq(key: string, tx?: Tx): Promise<number> {
  const c = await (tx ?? db).counter.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return c.value;
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");

export const nextPatientCode = async (tx?: Tx) => `SHR-${pad(await nextSeq("patient", tx), 6)}`;
export const nextPackageCode = async (tx?: Tx) => `PKG-${pad(await nextSeq("package", tx), 6)}`;
export const nextExpenseCode = async (tx?: Tx) => `EXP-${pad(await nextSeq("expense", tx), 5)}`;
export const nextLeadCode = async (tx?: Tx) => `LD-${pad(await nextSeq("lead", tx), 5)}`;
export const nextStaffCode = async (tx?: Tx) => `EMP-${pad(await nextSeq("staff", tx), 3)}`;
export const nextPurchaseCode = async (tx?: Tx) => `PUR-${pad(await nextSeq("purchase", tx), 5)}`;
export const nextProductSku = async (tx?: Tx) => `PRD-${pad(await nextSeq("product", tx), 4)}`;

/** GST-compliant invoice number (≤16 chars, unique per financial year), e.g. "FLG/2526/0001". */
export async function nextInvoiceNumber(branchCode: string, tx?: Tx, date = new Date()) {
  const fy = financialYear(date).replace("-", "");
  const { invoicePrefix } = await getSetting("billing");
  const n = await nextSeq(`invoice:${branchCode}:${fy}`, tx);
  return `${invoicePrefix ? invoicePrefix + "-" : ""}${branchCode}/${fy}/${pad(n, 4)}`;
}

export async function nextCreditNoteNumber(branchCode: string, tx?: Tx, date = new Date()) {
  const fy = financialYear(date).replace("-", "");
  const n = await nextSeq(`creditnote:${branchCode}:${fy}`, tx);
  return `CN/${branchCode}/${fy}/${pad(n, 4)}`;
}

export async function nextReceiptNumber(branchCode: string, tx?: Tx) {
  const n = await nextSeq(`receipt:${branchCode}`, tx);
  return `RC-${branchCode}-${pad(n, 6)}`;
}
