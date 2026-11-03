"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import type { InvoiceItemKind } from "@prisma/client";
import { db } from "@/lib/db";
import { ActionError, assertPermission, can } from "@/lib/auth";
import { assertBranchAccess, resolveWriteBranch } from "@/lib/branch";
import { formObject, handle, parse, zf, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { computeInvoice, type LineInput } from "@/lib/gst";
import { recalcInvoice } from "@/lib/billing";
import { createPackage } from "@/lib/packages";
import { stockIn, stockOut } from "@/lib/inventory";
import { nextCreditNoteNumber, nextInvoiceNumber, nextReceiptNumber } from "@/lib/sequence";
import { istDateKey, money, r2, toNum } from "@/lib/format";
import { PAYMENT_METHOD_LABEL } from "@/lib/status";
import { discountAllowance } from "@/lib/invoice";
import { collectPayment } from "./_lib/money";

const CASH_METHODS = ["CASH", "UPI", "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "ONLINE"] as const;

const LineSchema = z.object({
  kind: z.enum(["TREATMENT", "PACKAGE", "PRODUCT", "CONSULTATION", "OTHER"]),
  description: z.string().trim().max(200).optional().default(""),
  treatmentId: z.string().nullish(),
  productId: z.string().nullish(),
  packageId: z.string().nullish(),
  newPackage: z
    .object({
      treatmentId: z.string().min(1, "choose the treatment for the new package"),
      totalSessions: z.coerce.number().int("sessions must be a whole number").min(1, "at least 1 session").max(100),
      bodyArea: z.string().trim().max(80).nullish(),
    })
    .nullish(),
  quantity: z.coerce.number().positive("quantity must be more than 0").max(1000),
  unitPrice: z.coerce.number().min(0, "price cannot be negative"),
  discount: z.coerce.number().min(0, "discount cannot be negative").default(0),
});
const PaymentRowSchema = z.object({
  method: z.enum(CASH_METHODS),
  amount: z.coerce.number().min(0),
  reference: z.string().trim().max(100).nullish(),
});

function parseJson<S extends z.ZodType>(schema: S, raw: FormDataEntryValue | null, label: string): z.infer<S> {
  let data: unknown;
  try {
    data = JSON.parse(typeof raw === "string" ? raw : "null");
  } catch {
    throw new ActionError(`Invalid ${label}.`);
  }
  const r = schema.safeParse(data);
  if (!r.success) {
    const i = r.error.issues[0]!;
    const idx = typeof i.path[0] === "number" ? `${label === "items" ? "Item" : "Payment"} ${(i.path[0] as number) + 1}: ` : "";
    throw new ActionError(`${idx}${i.message}`);
  }
  return r.data;
}

const HeaderSchema = z.object({
  patientId: zf.id("Patient"),
  branchId: zf.optId(),
  date: zf.date("Invoice date"),
  notes: zf.optText(),
  advanceAmount: zf.optNum(),
});

/** Create an invoice with items, optional new packages, product stock deduction and payments — all in one transaction. */
export async function createInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let invoiceId = "";
  const res = await handle(async () => {
    const user = await assertPermission("billing.create");
    const head = parse(HeaderSchema, formObject(fd));
    const lines = parseJson(z.array(LineSchema).min(1, "Add at least one item"), fd.get("lines"), "items");
    const payRows = parseJson(z.array(PaymentRowSchema).max(10), fd.get("payments") ?? "[]", "payments").filter((p) => p.amount > 0);
    const advanceAmount = r2(head.advanceAmount ?? 0);
    if (advanceAmount < 0) throw new ActionError("Advance amount cannot be negative.");

    const branchId = await resolveWriteBranch(head.branchId);
    if (istDateKey(head.date) > istDateKey()) throw new ActionError("Invoice date cannot be in the future.");

    const patient = await db.patient.findFirst({ where: { id: head.patientId, deletedAt: null } });
    if (!patient) throw new ActionError("Patient not found.");

    const billing = await getSetting("billing");
    const canDiscount = can(user, "billing.discount");
    const allowance = discountAllowance({
      canDiscount,
      unlimited: user.roleKey === "OWNER" || can(user, "billing.refund"),
      maxPercent: billing.maxDiscountPercentWithoutApproval,
    });

    // Resolve every line against the catalogue (server is the source of truth for prices & GST rates).
    const treatmentIds = [...new Set(lines.flatMap((l) => [l.treatmentId, l.newPackage?.treatmentId]).filter(Boolean) as string[])];
    const productIds = [...new Set(lines.map((l) => l.productId).filter(Boolean) as string[])];
    const packageIds = [...new Set(lines.map((l) => l.packageId).filter(Boolean) as string[])];
    const [treatments, products, packages] = await Promise.all([
      db.treatment.findMany({ where: { id: { in: treatmentIds }, deletedAt: null } }),
      db.product.findMany({ where: { id: { in: productIds }, deletedAt: null } }),
      db.treatmentPackage.findMany({ where: { id: { in: packageIds }, deletedAt: null }, include: { treatment: true } }),
    ]);
    const T = new Map(treatments.map((t) => [t.id, t]));
    const P = new Map(products.map((p) => [p.id, p]));
    const PK = new Map(packages.map((p) => [p.id, p]));

    type Resolved = LineInput & { newPackage?: { treatmentId: string; totalSessions: number; bodyArea: string | null; name: string } };
    const resolved: Resolved[] = lines.map((l, i) => {
      const n = `Item ${i + 1}`;
      const gstOf = (rate: unknown) => (billing.gstEnabled ? toNum(rate as number) : 0);
      let r: Resolved;
      switch (l.kind) {
        case "TREATMENT": {
          const t = l.treatmentId ? T.get(l.treatmentId) : null;
          if (!t) throw new ActionError(`${n}: choose a treatment.`);
          r = { kind: "TREATMENT", description: l.description || t.name, quantity: l.quantity, unitPrice: toNum(t.defaultPrice), discount: l.discount, gstRate: gstOf(t.gstRate), treatmentId: t.id, hsnSac: billing.serviceSac };
          break;
        }
        case "PACKAGE": {
          if (l.packageId) {
            const pk = PK.get(l.packageId);
            if (!pk || pk.patientId !== patient.id) throw new ActionError(`${n}: package not found for this patient.`);
            if (pk.status === "CANCELLED") throw new ActionError(`${n}: package ${pk.code} is cancelled.`);
            r = { kind: "PACKAGE", description: l.description || `${pk.name} (${pk.code})`, quantity: 1, unitPrice: toNum(pk.price), discount: l.discount, gstRate: gstOf(pk.treatment.gstRate), treatmentId: pk.treatmentId, packageId: pk.id, hsnSac: billing.serviceSac };
          } else if (l.newPackage) {
            const t = T.get(l.newPackage.treatmentId);
            if (!t) throw new ActionError(`${n}: choose the package treatment.`);
            if (!(l.unitPrice > 0)) throw new ActionError(`${n}: enter the package price.`);
            const area = l.newPackage.bodyArea && !t.name.toLowerCase().includes(l.newPackage.bodyArea.toLowerCase()) ? ` – ${l.newPackage.bodyArea}` : "";
            const name = `${t.name}${area} · ${l.newPackage.totalSessions} session${l.newPackage.totalSessions > 1 ? "s" : ""}`;
            r = { kind: "PACKAGE", description: l.description || name, quantity: 1, unitPrice: r2(l.unitPrice), discount: l.discount, gstRate: gstOf(t.gstRate), treatmentId: t.id, hsnSac: billing.serviceSac, newPackage: { treatmentId: t.id, totalSessions: l.newPackage.totalSessions, bodyArea: l.newPackage.bodyArea || null, name } };
          } else throw new ActionError(`${n}: pick an existing package or define a new one.`);
          break;
        }
        case "PRODUCT": {
          const p = l.productId ? P.get(l.productId) : null;
          if (!p) throw new ActionError(`${n}: choose a product.`);
          if (!p.isRetail) throw new ActionError(`${n}: ${p.name} is not a retail product.`);
          r = { kind: "PRODUCT", description: l.description || p.name, quantity: l.quantity, unitPrice: toNum(p.sellingPrice), discount: l.discount, gstRate: gstOf(p.gstRate), productId: p.id, hsnSac: p.hsnCode ?? "3304" };
          break;
        }
        case "CONSULTATION": {
          r = { kind: "CONSULTATION", description: l.description || "Doctor consultation", quantity: l.quantity, unitPrice: r2(l.unitPrice), discount: l.discount, gstRate: gstOf(billing.defaultServiceGst), treatmentId: l.treatmentId && T.get(l.treatmentId) ? l.treatmentId : null, hsnSac: billing.serviceSac };
          break;
        }
        default: {
          if (!l.description) throw new ActionError(`${n}: enter a description.`);
          r = { kind: "OTHER", description: l.description, quantity: l.quantity, unitPrice: r2(l.unitPrice), discount: l.discount, gstRate: gstOf(billing.defaultServiceGst), hsnSac: billing.serviceSac };
        }
      }
      const gross = r2(r.quantity * r.unitPrice);
      if (r.discount > gross + 0.009) throw new ActionError(`${n}: discount is more than the item value.`);
      if (r.discount > 0) {
        if (!canDiscount) throw new ActionError("You don't have permission to give discounts.");
        const pct = gross > 0 ? (r.discount / gross) * 100 : 0;
        if (pct > allowance + 0.01)
          throw new ActionError(`${n}: ${pct.toFixed(1)}% discount is above your limit of ${allowance}%. Ask the owner or accounts to approve it.`);
      }
      return r;
    });

    // Same package can't be billed twice.
    const dupPk = resolved.map((r) => r.packageId).filter(Boolean);
    if (new Set(dupPk).size !== dupPk.length) throw new ActionError("The same package appears twice.");
    if (dupPk.length) {
      const billed = await db.invoiceItem.findFirst({
        where: { packageId: { in: dupPk as string[] }, invoice: { status: { not: "CANCELLED" }, deletedAt: null } },
        include: { invoice: { select: { number: true } } },
      });
      if (billed) throw new ActionError(`That package is already billed on invoice ${billed.invoice.number}.`);
    }

    const totals = computeInvoice(resolved, { gstEnabled: billing.gstEnabled, pricesIncludeGst: billing.pricesIncludeGst, roundOff: billing.roundOff });
    const paySum = r2(payRows.reduce((s, p) => s + p.amount, 0) + advanceAmount);
    if (paySum > totals.total + 0.009)
      throw new ActionError(`Payments (${money(paySum)}) are more than the invoice total (${money(totals.total)}). Record any extra as an advance from Payments.`);

    const branch = await db.branch.findUniqueOrThrow({ where: { id: branchId } });

    const invoice = await db.$transaction(
      async (tx) => {
        // New packages first so their ids can be linked to invoice items.
        const items = [];
        for (let i = 0; i < totals.lines.length; i++) {
          const line = totals.lines[i]!;
          const src = resolved[i]!;
          let packageId = line.packageId ?? null;
          if (src.newPackage) {
            const pkg = await createPackage(
              {
                patientId: patient.id,
                treatmentId: src.newPackage.treatmentId,
                branchId,
                name: src.newPackage.name,
                bodyArea: src.newPackage.bodyArea,
                totalSessions: src.newPackage.totalSessions,
                price: r2(line.gross - line.discount),
                purchaseDate: head.date,
                doctorId: patient.assignedDoctorId,
                userId: user.id,
              },
              tx,
            );
            packageId = pkg.id;
            await audit(user.id, "CREATE", "TreatmentPackage", pkg.id, `Sold package ${pkg.code} – ${pkg.name} to ${patient.fullName}`, { branchId, tx });
          }
          items.push({
            kind: line.kind as InvoiceItemKind,
            treatmentId: line.treatmentId ?? null,
            productId: line.productId ?? null,
            packageId,
            description: line.description,
            hsnSac: line.hsnSac ?? null,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discount: r2(line.discount),
            gstRate: line.gstRate,
            taxable: line.taxable,
            tax: line.tax,
            total: line.total,
          });
        }

        const inv = await tx.invoice.create({
          data: {
            number: await nextInvoiceNumber(branch.code, tx, head.date),
            branchId,
            patientId: patient.id,
            date: head.date,
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            taxableAmount: totals.taxableAmount,
            cgst: totals.cgst,
            sgst: totals.sgst,
            igst: totals.igst,
            taxTotal: totals.taxTotal,
            roundOff: totals.roundOff,
            total: totals.total,
            balance: totals.total,
            notes: head.notes,
            createdById: user.id,
            items: { create: items },
          },
        });

        // Retail products leave stock (FEFO). Throws if not enough stock at this branch.
        for (const line of totals.lines) {
          if (line.kind === "PRODUCT" && line.productId) {
            await stockOut(
              { productId: line.productId, branchId, quantity: line.quantity, type: "SALE", unitPrice: r2(line.total / line.quantity), refType: "Invoice", refId: inv.id, notes: `Sold on ${inv.number}`, userId: user.id },
              tx,
            );
          }
        }

        await audit(user.id, "CREATE", "Invoice", inv.id, `Created invoice ${inv.number} for ${patient.fullName} — ${money(totals.total)} (${resolved.length} item${resolved.length > 1 ? "s" : ""})`, {
          branchId,
          tx,
          changes: { total: totals.total, discount: totals.discountTotal, tax: totals.taxTotal, items: resolved.map((r) => `${r.description} × ${r.quantity}`) },
        });

        // Payments taken with a back-dated invoice are dated to that invoice day; otherwise "now".
        const paidAt = istDateKey(head.date) === istDateKey() ? new Date() : head.date;
        if (advanceAmount > 0)
          await collectPayment(tx, { patientId: patient.id, branchId, invoiceId: inv.id, amount: advanceAmount, method: "ADVANCE", reference: "Adjusted from advance", paidAt, userId: user.id });
        for (const p of payRows)
          await collectPayment(tx, { patientId: patient.id, branchId, invoiceId: inv.id, amount: p.amount, method: p.method, reference: p.reference ?? null, paidAt, userId: user.id });

        if (!patient.firstVisitAt) await tx.patient.update({ where: { id: patient.id }, data: { firstVisitAt: head.date } });
        return recalcInvoice(inv.id, tx);
      },
      { timeout: 20000, maxWait: 10000 },
    );
    invoiceId = invoice.id;
  });
  if (res && !res.ok) return res;
  redirect(`/billing/${invoiceId}?created=1`);
}

// ─────────────────────────────── existing invoice actions ───────────────────────────────

async function loadInvoice(id: string) {
  const inv = await db.invoice.findFirst({ where: { id, deletedAt: null }, include: { patient: { select: { fullName: true } } } });
  if (!inv) throw new ActionError("Invoice not found.");
  return inv;
}

const PaymentSchema = z.object({
  invoiceId: zf.id("Invoice"),
  method: zf.enumOf(CASH_METHODS, "Payment method"),
  amount: zf.num("Amount").pipe(z.number().positive("Amount must be more than 0")),
  reference: zf.optText(),
  notes: zf.optText(),
});

export async function recordInvoicePaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("billing.create");
    const d = parse(PaymentSchema, formObject(fd));
    const inv = await loadInvoice(d.invoiceId);
    await assertBranchAccess(user, inv.branchId);
    const p = await db.$transaction((tx) =>
      collectPayment(tx, { patientId: inv.patientId, branchId: inv.branchId, invoiceId: inv.id, amount: d.amount, method: d.method, reference: d.reference, notes: d.notes, userId: user.id }),
    );
    return { ok: true, message: `Payment of ${money(d.amount)} recorded (receipt ${p.receiptNo})`, id: p.id };
  });
}

export async function applyAdvanceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("billing.create");
    const d = parse(z.object({ invoiceId: zf.id("Invoice"), amount: zf.num("Amount").pipe(z.number().positive("Amount must be more than 0")) }), formObject(fd));
    const inv = await loadInvoice(d.invoiceId);
    await assertBranchAccess(user, inv.branchId);
    await db.$transaction((tx) =>
      collectPayment(tx, { patientId: inv.patientId, branchId: inv.branchId, invoiceId: inv.id, amount: d.amount, method: "ADVANCE", reference: "Adjusted from advance", userId: user.id }),
    );
    return { ok: true, message: `${money(d.amount)} adjusted from advance` };
  });
}

const CreditSchema = z.object({
  invoiceId: zf.id("Invoice"),
  mode: zf.enumOf(["REDUCE", "REFUND"] as const, "Type"),
  amount: zf.num("Amount").pipe(z.number().positive("Amount must be more than 0")),
  reason: zf.text("Reason", 3),
  refundMethod: z.preprocess((v) => (v === "" ? undefined : v), z.enum(CASH_METHODS).optional()),
  reference: zf.optText(),
});

/**
 * Credit note rules:
 *  - REDUCE ("write off / reduce amount due"): amount ≤ current balance. No money moves.
 *  - REFUND ("refund money paid"): amount ≤ net amount paid; a REFUND payment of the same amount is recorded.
 *  - Either way the total credited can never exceed the invoice total.
 */
export async function creditNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("billing.refund");
    const d = parse(CreditSchema, formObject(fd));
    const inv = await loadInvoice(d.invoiceId);
    await assertBranchAccess(user, inv.branchId);
    if (inv.status === "CANCELLED") throw new ActionError("This invoice is cancelled.");
    const amount = r2(d.amount);
    const creditable = r2(toNum(inv.total) - toNum(inv.creditedAmount));
    if (amount > creditable + 0.009) throw new ActionError(`Only ${money(creditable)} of this invoice can still be credited.`);
    if (d.mode === "REDUCE" && amount > toNum(inv.balance) + 0.009)
      throw new ActionError(`To reduce the amount due, the credit can't exceed the balance (${money(inv.balance)}). Use "Refund money paid" for money already collected.`);
    if (d.mode === "REFUND") {
      if (!d.refundMethod) throw new ActionError("Choose how the money is refunded.");
      if (amount > toNum(inv.paidAmount) + 0.009) throw new ActionError(`Refund can't exceed the amount paid (${money(inv.paidAmount)}).`);
    }
    const branch = await db.branch.findUniqueOrThrow({ where: { id: inv.branchId }, select: { code: true } });

    const cn = await db.$transaction(async (tx) => {
      const note = await tx.creditNote.create({
        data: {
          number: await nextCreditNoteNumber(branch.code, tx),
          invoiceId: inv.id,
          patientId: inv.patientId,
          branchId: inv.branchId,
          amount,
          reason: d.reason,
          refundMethod: d.mode === "REFUND" ? d.refundMethod : null,
          createdById: user.id,
        },
      });
      if (d.mode === "REFUND") {
        await tx.payment.create({
          data: {
            receiptNo: await nextReceiptNumber(branch.code, tx),
            kind: "REFUND",
            invoiceId: inv.id,
            patientId: inv.patientId,
            branchId: inv.branchId,
            amount,
            method: d.refundMethod!,
            reference: d.reference,
            notes: `Refund against ${note.number}: ${d.reason}`,
            receivedById: user.id,
          },
        });
      }
      await recalcInvoice(inv.id, tx);
      await audit(
        user.id,
        "REFUND",
        "Invoice",
        inv.id,
        d.mode === "REFUND"
          ? `Refunded ${money(amount)} by ${PAYMENT_METHOD_LABEL[d.refundMethod!]} on ${inv.number} (credit note ${note.number}) — ${d.reason}`
          : `Credit note ${note.number} for ${money(amount)} reduced amount due on ${inv.number} — ${d.reason}`,
        { branchId: inv.branchId, tx, changes: { mode: d.mode, amount, reason: d.reason } },
      );
      return note;
    });
    return { ok: true, message: `Credit note ${cn.number} issued` };
  });
}

/**
 * Cancel rules: only when nothing is held from the patient (net paid = 0 — refund first), and no package on
 * the invoice has a completed session. Retail products go back into the batches they came from;
 * packages are cancelled together with their still-scheduled sessions.
 */
export async function cancelInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("billing.cancel");
    const d = parse(z.object({ invoiceId: zf.id("Invoice"), reason: zf.text("Reason", 3) }), formObject(fd));
    const inv = await db.invoice.findFirst({ where: { id: d.invoiceId, deletedAt: null }, include: { items: { include: { package: true } } } });
    if (!inv) throw new ActionError("Invoice not found.");
    await assertBranchAccess(user, inv.branchId);
    if (inv.status === "CANCELLED") throw new ActionError("Invoice is already cancelled.");
    if (toNum(inv.paidAmount) > 0.009)
      throw new ActionError(`${money(inv.paidAmount)} has been collected on this invoice. Refund it first (Credit note → Refund money paid), then cancel.`);
    for (const it of inv.items) {
      if (it.package && it.package.completedSessions > 0)
        throw new ActionError(`Package ${it.package.code} already has ${it.package.completedSessions} completed session(s), so this invoice can't be cancelled. Issue a credit note instead.`);
    }

    await db.$transaction(
      async (tx) => {
        const sales = await tx.inventoryTransaction.findMany({ where: { refType: "Invoice", refId: inv.id, type: "SALE" }, include: { batch: true } });
        for (const s of sales) {
          const qty = -toNum(s.quantity);
          if (qty <= 0) continue;
          await stockIn(
            {
              productId: s.productId,
              branchId: s.branchId,
              quantity: qty,
              batchNo: s.batch?.batchNo ?? null,
              expiryDate: s.batch?.expiryDate ?? null,
              unitCost: s.batch ? toNum(s.batch.purchasePrice) : null,
              type: "CUSTOMER_RETURN",
              refType: "Invoice",
              refId: inv.id,
              notes: `Invoice ${inv.number} cancelled`,
              userId: user.id,
            },
            tx,
          );
        }
        for (const it of inv.items) {
          if (!it.package || it.package.status === "CANCELLED") continue;
          await tx.treatmentPackage.update({ where: { id: it.package.id }, data: { status: "CANCELLED", notes: `${it.package.notes ? it.package.notes + "\n" : ""}Cancelled with invoice ${inv.number}: ${d.reason}` } });
          await tx.treatmentSession.updateMany({ where: { packageId: it.package.id, status: "SCHEDULED" }, data: { status: "CANCELLED", adjustmentReason: `Invoice ${inv.number} cancelled` } });
        }
        await tx.invoice.update({ where: { id: inv.id }, data: { status: "CANCELLED", cancelReason: d.reason, balance: 0 } });
        await audit(user.id, "CANCEL", "Invoice", inv.id, `Cancelled invoice ${inv.number} (${money(inv.total)}) — ${d.reason}`, { branchId: inv.branchId, tx });
      },
      { timeout: 20000 },
    );
    return { ok: true, message: `Invoice ${inv.number} cancelled` };
  });
}
