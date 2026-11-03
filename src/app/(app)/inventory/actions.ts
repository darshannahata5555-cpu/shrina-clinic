"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { ActionError, assertPermission } from "@/lib/auth";
import { assertBranchAccess, resolveWriteBranch } from "@/lib/branch";
import { handle, parse, formObject, zf, type ActionState } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { nextExpenseCode, nextProductSku, nextPurchaseCode } from "@/lib/sequence";
import { stockIn, stockOut } from "@/lib/inventory";
import { notifyUsers } from "@/lib/notify";
import { fmtNum, money, r2, toNum } from "@/lib/format";
import { TXN_LABEL } from "./_lib/labels";

const positive = (label: string) => zf.num(label).refine((n) => n > 0, `${label} must be more than 0`);
const nonNeg = (label: string) => zf.num(label).refine((n) => n >= 0, `${label} cannot be negative`);

// ───────────────────────────── Products ─────────────────────────────

const ProductSchema = z.object({
  id: zf.optId(),
  name: zf.text("Product name"),
  sku: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().toUpperCase().max(30).optional()),
  category: zf.text("Category"),
  brand: zf.optText(),
  unit: zf.text("Unit"),
  purchasePrice: nonNeg("Purchase price"),
  sellingPrice: nonNeg("Selling price"),
  gstRate: nonNeg("GST rate").refine((n) => n <= 40, "GST rate looks wrong"),
  hsnCode: zf.optText(),
  minStock: nonNeg("Minimum stock"),
  isRetail: zf.bool(),
  isActive: zf.bool(),
  supplierId: zf.optId(),
  description: zf.optText(),
});

export async function saveProductAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("inventory.manage");
    const { id, sku, ...data } = parse(ProductSchema, formObject(fd));
    if (id) {
      const before = await db.product.findFirstOrThrow({ where: { id, deletedAt: null } });
      const after = await db.product.update({ where: { id }, data: { ...data, ...(sku ? { sku } : {}) } });
      await audit(user.id, "UPDATE", "Product", id, `Updated product ${after.name} (${after.sku})`, {
        changes: diff(before, after, [...Object.keys(data), "sku"]),
      });
      return { ok: true, message: "Product updated", id };
    }
    const created = await db.$transaction(async (tx) =>
      tx.product.create({ data: { ...data, sku: sku || (await nextProductSku(tx)) } }),
    );
    await audit(user.id, "CREATE", "Product", created.id, `Added product ${created.name} (${created.sku})`);
    return { ok: true, message: `Product ${created.sku} added`, id: created.id };
  });
}

export async function deleteProductAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("inventory.manage");
    const id = String(fd.get("id"));
    const p = await db.product.findFirstOrThrow({ where: { id, deletedAt: null } });
    await db.product.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await audit(user.id, "DELETE", "Product", id, `Deleted product ${p.name} (${p.sku})`);
    redirect("/inventory");
  });
}

// ───────────────────────────── Stock movements ─────────────────────────────

const StockInSchema = z
  .object({
    productId: zf.id("Product"),
    branchId: zf.optId(),
    type: z.enum(["PURCHASE", "ADJUSTMENT_IN", "CUSTOMER_RETURN"], { error: "Choose a reason" }),
    quantity: positive("Quantity"),
    batchNo: zf.optText(),
    expiryDate: zf.optDate(),
    unitCost: zf.optNum(),
    supplierId: zf.optId(),
    notes: zf.optText(),
  })
  .refine((v) => v.type === "PURCHASE" || !!v.notes, { path: ["notes"], message: "Add a note explaining this entry" });

export async function stockInAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("inventory.manage");
    const v = parse(StockInSchema, formObject(fd));
    const branchId = await resolveWriteBranch(v.branchId);
    const product = await db.product.findFirstOrThrow({ where: { id: v.productId, deletedAt: null } });
    await db.$transaction(async (tx) => {
      await stockIn(
        {
          productId: v.productId,
          branchId,
          quantity: v.quantity,
          batchNo: v.batchNo,
          expiryDate: v.expiryDate,
          unitCost: v.unitCost,
          supplierId: v.supplierId,
          type: v.type,
          refType: "Manual",
          notes: v.notes,
          userId: user.id,
        },
        tx,
      );
      await audit(user.id, "CREATE", "InventoryTransaction", v.productId, `${TXN_LABEL[v.type]}: +${fmtNum(v.quantity)} ${product.unit} ${product.name}${v.batchNo ? ` (batch ${v.batchNo})` : ""}`, {
        branchId,
        changes: { type: v.type, quantity: v.quantity, notes: v.notes },
        tx,
      });
    });
    return { ok: true, message: `Added ${fmtNum(v.quantity)} ${product.unit} to stock` };
  });
}

const StockOutSchema = z.object({
  productId: zf.id("Product"),
  branchId: zf.optId(),
  type: z.enum(["ADJUSTMENT_OUT", "DAMAGE", "EXPIRED", "RETURN_TO_SUPPLIER"], { error: "Choose a reason" }),
  quantity: positive("Quantity"),
  batchId: zf.optId(),
  notes: zf.text("Note"),
});

export async function stockOutAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("inventory.manage");
    const v = parse(StockOutSchema, formObject(fd));
    const branchId = await resolveWriteBranch(v.branchId);
    const product = await db.product.findFirstOrThrow({ where: { id: v.productId, deletedAt: null } });
    if (v.batchId) {
      const batch = await db.productBatch.findFirst({ where: { id: v.batchId, productId: v.productId, branchId } });
      if (!batch) throw new ActionError("That batch is not at the selected branch.");
    }
    await db.$transaction(async (tx) => {
      await stockOut(
        { productId: v.productId, branchId, quantity: v.quantity, type: v.type, batchId: v.batchId, refType: "Manual", notes: v.notes, userId: user.id },
        tx,
      );
      await audit(user.id, "CREATE", "InventoryTransaction", v.productId, `${TXN_LABEL[v.type]}: −${fmtNum(v.quantity)} ${product.unit} ${product.name} — ${v.notes}`, {
        branchId,
        changes: { type: v.type, quantity: v.quantity, batchId: v.batchId },
        tx,
      });
    });
    return { ok: true, message: `Removed ${fmtNum(v.quantity)} ${product.unit} from stock` };
  });
}

const TransferSchema = z
  .object({
    productId: zf.id("Product"),
    fromBranchId: zf.id("From branch"),
    toBranchId: zf.id("To branch"),
    quantity: positive("Quantity"),
    batchId: zf.optId(),
    notes: zf.optText(),
  })
  .refine((v) => v.fromBranchId !== v.toBranchId, { path: ["toBranchId"], message: "Choose a different branch" });

/** Move stock between branches, preserving batch number, expiry and cost. */
export async function transferStockAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("inventory.manage");
    const v = parse(TransferSchema, formObject(fd));
    await assertBranchAccess(user, v.fromBranchId);
    const [product, from, to] = await Promise.all([
      db.product.findFirstOrThrow({ where: { id: v.productId, deletedAt: null } }),
      db.branch.findUniqueOrThrow({ where: { id: v.fromBranchId } }),
      db.branch.findUniqueOrThrow({ where: { id: v.toBranchId } }),
    ]);
    if (!to.isActive) throw new ActionError(`${to.name} is inactive.`);
    const transferId = randomUUID();
    await db.$transaction(async (tx) => {
      await stockOut(
        {
          productId: v.productId,
          branchId: from.id,
          quantity: v.quantity,
          type: "TRANSFER_OUT",
          batchId: v.batchId,
          refType: "Transfer",
          refId: transferId,
          notes: `Transfer to ${to.name}${v.notes ? ` · ${v.notes}` : ""}`,
          userId: user.id,
        },
        tx,
      );
      // Re-create exactly the consumed batches at the destination.
      const outs = await tx.inventoryTransaction.findMany({
        where: { refType: "Transfer", refId: transferId, type: "TRANSFER_OUT" },
        include: { batch: true },
      });
      for (const o of outs) {
        if (!o.batch) continue;
        await stockIn(
          {
            productId: v.productId,
            branchId: to.id,
            quantity: -toNum(o.quantity),
            batchNo: o.batch.batchNo,
            expiryDate: o.batch.expiryDate,
            unitCost: toNum(o.batch.purchasePrice),
            supplierId: o.batch.supplierId,
            type: "TRANSFER_IN",
            refType: "Transfer",
            refId: transferId,
            notes: `Transfer from ${from.name}${v.notes ? ` · ${v.notes}` : ""}`,
            userId: user.id,
          },
          tx,
        );
      }
      await audit(user.id, "TRANSFER", "Product", v.productId, `Transferred ${fmtNum(v.quantity)} ${product.unit} ${product.name} from ${from.name} to ${to.name}`, {
        branchId: from.id,
        changes: { transferId, from: from.id, to: to.id, quantity: v.quantity },
        tx,
      });
    });
    await notifyUsers({
      permission: "inventory.manage",
      branchId: to.id,
      title: "Stock transferred in",
      body: `${fmtNum(v.quantity)} ${product.unit} of ${product.name} sent from ${from.name}`,
      link: `/inventory/${product.id}`,
    });
    return { ok: true, message: `Transferred ${fmtNum(v.quantity)} ${product.unit} to ${to.name}` };
  });
}

// ───────────────────────────── Purchases ─────────────────────────────

const PurchaseItem = z.object({
  productId: z.string().min(1, "Choose a product"),
  batchNo: z.string().trim().max(40).optional().default(""),
  expiryDate: z.string().optional().default(""),
  quantity: z.coerce.number().positive("Quantity must be more than 0"),
  unitCost: z.coerce.number().min(0, "Cost cannot be negative"),
});

const PurchaseSchema = z.object({
  supplierId: zf.id("Supplier"),
  branchId: zf.optId(),
  billNo: zf.optText(),
  purchaseDate: zf.date("Purchase date"),
  notes: zf.optText(),
  addExpense: zf.bool(),
  expenseMethod: z.enum(["CASH", "UPI", "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "ONLINE"]).optional(),
  items: z.string().transform((s, ctx) => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "Add at least one item" });
      return z.NEVER;
    }
  }).pipe(z.array(PurchaseItem).min(1, "Add at least one item")),
});

export async function createPurchaseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("inventory.manage");
    const v = parse(PurchaseSchema, formObject(fd));
    const branchId = await resolveWriteBranch(v.branchId);
    const supplier = await db.supplier.findFirstOrThrow({ where: { id: v.supplierId, deletedAt: null } });
    const items = v.items.map((i) => ({
      productId: i.productId,
      batchNo: i.batchNo?.trim() || "GENERAL",
      expiryDate: i.expiryDate && /^\d{4}-\d{2}-\d{2}$/.test(i.expiryDate) ? new Date(`${i.expiryDate}T00:00:00+05:30`) : null,
      quantity: i.quantity,
      unitCost: i.unitCost,
    }));
    const total = r2(items.reduce((s, i) => s + i.quantity * i.unitCost, 0));
    if (v.addExpense && !(user.permissions.has("expenses.create") || user.permissions.has("expenses.approve")))
      throw new ActionError("You don't have permission to record expenses — untick “Also record as expense”.");

    const purchase = await db.$transaction(async (tx) => {
      const number = await nextPurchaseCode(tx);
      const p = await tx.purchase.create({
        data: {
          number,
          supplierId: supplier.id,
          branchId,
          billNo: v.billNo,
          purchaseDate: v.purchaseDate,
          totalAmount: total,
          notes: v.notes,
          createdById: user.id,
          items: { create: items },
        },
      });
      for (const i of items) {
        await stockIn(
          {
            productId: i.productId,
            branchId,
            quantity: i.quantity,
            batchNo: i.batchNo,
            expiryDate: i.expiryDate,
            unitCost: i.unitCost,
            supplierId: supplier.id,
            type: "PURCHASE",
            refType: "Purchase",
            refId: p.id,
            notes: `${number}${v.billNo ? ` · bill ${v.billNo}` : ""}`,
            userId: user.id,
          },
          tx,
        );
      }
      await audit(user.id, "CREATE", "Purchase", p.id, `Recorded purchase ${number} from ${supplier.name} — ${money(total)} (${items.length} item${items.length > 1 ? "s" : ""})`, { branchId, tx });

      if (v.addExpense) {
        const autoApprove = user.permissions.has("expenses.approve");
        const exp = await tx.expense.create({
          data: {
            code: await nextExpenseCode(tx),
            branchId,
            date: v.purchaseDate,
            category: "PRODUCT_PURCHASE",
            amount: total,
            paidTo: supplier.name,
            method: v.expenseMethod ?? "BANK_TRANSFER",
            description: `Purchase ${number}${v.billNo ? ` · bill ${v.billNo}` : ""}`,
            addedById: user.id,
            status: autoApprove ? "APPROVED" : "PENDING",
            approvedById: autoApprove ? user.id : null,
            approvedAt: autoApprove ? new Date() : null,
          },
        });
        await audit(user.id, "CREATE", "Expense", exp.id, `Expense ${exp.code} for purchase ${number} — ${money(total)}`, { branchId, tx });
        if (!autoApprove)
          await notifyUsers(
            { permission: "expenses.approve", branchId, title: "Expense awaiting approval", body: `${exp.code}: ${money(total)} to ${supplier.name} (purchase ${number})`, link: "/expenses?status=PENDING" },
            tx,
          );
      }
      return p;
    });
    redirect(`/inventory/purchases/${purchase.id}`);
  });
}

// ───────────────────────────── Suppliers ─────────────────────────────

const SupplierSchema = z.object({
  id: zf.optId(),
  name: zf.text("Supplier name"),
  contactPerson: zf.optText(),
  phone: zf.optText(),
  email: zf.optEmail(),
  gstin: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().toUpperCase().regex(/^\d{2}[A-Z0-9]{13}$/, "GSTIN must be 15 characters").optional()).transform((v) => v ?? null),
  address: zf.optText(),
  notes: zf.optText(),
  isActive: zf.bool(),
});

export async function saveSupplierAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("inventory.manage");
    const { id, ...data } = parse(SupplierSchema, formObject(fd));
    if (id) {
      const before = await db.supplier.findFirstOrThrow({ where: { id, deletedAt: null } });
      const after = await db.supplier.update({ where: { id }, data });
      await audit(user.id, "UPDATE", "Supplier", id, `Updated supplier ${after.name}`, { changes: diff(before, after, Object.keys(data)) });
      return { ok: true, message: "Supplier updated", id };
    }
    const s = await db.supplier.create({ data });
    await audit(user.id, "CREATE", "Supplier", s.id, `Added supplier ${s.name}`);
    return { ok: true, message: "Supplier added", id: s.id };
  });
}

export async function deleteSupplierAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("inventory.manage");
    const id = String(fd.get("id"));
    const s = await db.supplier.findFirstOrThrow({ where: { id, deletedAt: null } });
    await db.supplier.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await audit(user.id, "DELETE", "Supplier", id, `Deleted supplier ${s.name}`);
    return { ok: true, message: "Supplier deleted" };
  });
}
