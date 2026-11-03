import "server-only";
import { Prisma, type InventoryTxnType } from "@prisma/client";
import { db, type Tx } from "./db";
import { ActionError } from "./auth";
import { r2, toNum } from "./format";

/**
 * Stock model: every unit of stock lives in a ProductBatch (per branch). Current stock
 * = sum(batch.quantity). Every movement is also written to InventoryTransaction
 * (signed quantity) for a complete history. Stock-out consumes batches FEFO
 * (first-expiry-first-out).
 */

export async function stockOf(productId: string, branchId: string, tx?: Tx): Promise<number> {
  const agg = await (tx ?? db).productBatch.aggregate({
    where: { productId, branchId },
    _sum: { quantity: true },
  });
  return toNum(agg._sum.quantity);
}

/** productId → quantity, summed over the given branches. */
export async function stockMap(branchIds: string[], productIds?: string[]): Promise<Map<string, number>> {
  const rows = await db.productBatch.groupBy({
    by: ["productId"],
    where: { branchId: { in: branchIds }, ...(productIds ? { productId: { in: productIds } } : {}) },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.productId, toNum(r._sum.quantity)]));
}

export type StockInInput = {
  productId: string;
  branchId: string;
  quantity: number;
  batchNo?: string | null;
  expiryDate?: Date | null;
  unitCost?: number | null;
  supplierId?: string | null;
  type?: Extract<InventoryTxnType, "PURCHASE" | "ADJUSTMENT_IN" | "CUSTOMER_RETURN" | "TRANSFER_IN">;
  refType?: string;
  refId?: string;
  notes?: string | null;
  userId?: string | null;
};

export async function stockIn(input: StockInInput, tx: Tx) {
  if (!(input.quantity > 0)) throw new ActionError("Quantity must be greater than zero.");
  const product = await tx.product.findUniqueOrThrow({ where: { id: input.productId } });
  const unitCost = input.unitCost ?? toNum(product.purchasePrice);
  const batchNo = input.batchNo?.trim() || "GENERAL";

  // Merge into an existing batch with the same number/expiry at this branch.
  const existing = await tx.productBatch.findFirst({
    where: { productId: input.productId, branchId: input.branchId, batchNo, expiryDate: input.expiryDate ?? null },
  });
  const batch = existing
    ? await tx.productBatch.update({
        where: { id: existing.id },
        data: { quantity: { increment: input.quantity }, initialQty: { increment: input.quantity } },
      })
    : await tx.productBatch.create({
        data: {
          productId: input.productId,
          branchId: input.branchId,
          batchNo,
          expiryDate: input.expiryDate ?? null,
          quantity: input.quantity,
          initialQty: input.quantity,
          purchasePrice: unitCost,
          supplierId: input.supplierId ?? product.supplierId,
        },
      });

  await tx.inventoryTransaction.create({
    data: {
      productId: input.productId,
      branchId: input.branchId,
      batchId: batch.id,
      type: input.type ?? "PURCHASE",
      quantity: input.quantity,
      unitCost,
      refType: input.refType,
      refId: input.refId,
      notes: input.notes ?? null,
      createdById: input.userId ?? null,
    },
  });
  return batch;
}

export type StockOutInput = {
  productId: string;
  branchId: string;
  quantity: number;
  type: Extract<
    InventoryTxnType,
    "SALE" | "TREATMENT_USAGE" | "ADJUSTMENT_OUT" | "DAMAGE" | "EXPIRED" | "RETURN_TO_SUPPLIER" | "TRANSFER_OUT"
  >;
  /** consume a specific batch instead of FEFO */
  batchId?: string | null;
  unitPrice?: number | null;
  refType?: string;
  refId?: string;
  notes?: string | null;
  userId?: string | null;
  /** When true (treatment usage), a shortage does not throw; the shortfall is returned. */
  allowShortfall?: boolean;
};

export async function stockOut(input: StockOutInput, tx: Tx): Promise<{ consumed: number; shortfall: number }> {
  if (!(input.quantity > 0)) throw new ActionError("Quantity must be greater than zero.");
  const batches = await tx.productBatch.findMany({
    where: {
      productId: input.productId,
      branchId: input.branchId,
      quantity: { gt: 0 },
      ...(input.batchId ? { id: input.batchId } : {}),
    },
    orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }, { purchaseDate: "asc" }],
  });
  const available = batches.reduce((s, b) => s + toNum(b.quantity), 0);
  if (available + 1e-9 < input.quantity && !input.allowShortfall) {
    const p = await tx.product.findUnique({ where: { id: input.productId }, select: { name: true, unit: true } });
    throw new ActionError(
      `Not enough stock for ${p?.name ?? "product"}: ${r2(available)} ${p?.unit ?? ""} available, ${input.quantity} needed.`,
    );
  }

  let left = input.quantity;
  for (const b of batches) {
    if (left <= 1e-9) break;
    const take = Math.min(left, toNum(b.quantity));
    await tx.productBatch.update({ where: { id: b.id }, data: { quantity: { decrement: take } } });
    await tx.inventoryTransaction.create({
      data: {
        productId: input.productId,
        branchId: input.branchId,
        batchId: b.id,
        type: input.type,
        quantity: new Prisma.Decimal(-take),
        unitCost: b.purchasePrice,
        unitPrice: input.unitPrice ?? null,
        refType: input.refType,
        refId: input.refId,
        notes: input.notes ?? null,
        createdById: input.userId ?? null,
      },
    });
    left = r2(left - take);
  }

  const shortfall = left > 1e-9 ? r2(left) : 0;
  if (shortfall > 0) {
    // Record the untracked usage so the history is complete; stock stays at zero.
    await tx.inventoryTransaction.create({
      data: {
        productId: input.productId,
        branchId: input.branchId,
        type: input.type,
        quantity: new Prisma.Decimal(-shortfall),
        refType: input.refType,
        refId: input.refId,
        notes: `${input.notes ? input.notes + " · " : ""}SHORTFALL: stock was not available`,
        createdById: input.userId ?? null,
      },
    });
  }
  return { consumed: r2(input.quantity - shortfall), shortfall };
}

/** Products at/below minimum stock in the given branches. */
export async function lowStockProducts(branchIds: string[]) {
  const products = await db.product.findMany({
    where: { deletedAt: null, isActive: true },
    select: { id: true, name: true, sku: true, unit: true, minStock: true, category: true },
  });
  const stock = await stockMap(branchIds);
  return products
    .map((p) => ({ ...p, stock: stock.get(p.id) ?? 0, min: toNum(p.minStock) }))
    .filter((p) => p.min > 0 && p.stock <= p.min)
    .sort((a, b) => a.stock / (a.min || 1) - b.stock / (b.min || 1));
}
