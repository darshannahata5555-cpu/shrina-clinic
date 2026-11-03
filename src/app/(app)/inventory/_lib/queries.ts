import "server-only";
import type { InventoryTxnType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDaysKey, fromIst, istDateKey, r2, toNum } from "@/lib/format";
import { TXN_LABEL } from "./labels";

type SP = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

/** Shared filter for the stock-movement log (page + Excel export). */
export function txnWhere(sp: SP, branchIds: string[]): Prisma.InventoryTransactionWhereInput {
  const type = Object.hasOwn(TXN_LABEL, str(sp.type)) ? str(sp.type) : "";
  const product = str(sp.product);
  const from = str(sp.from);
  const to = str(sp.to);
  return {
    branchId: { in: branchIds },
    ...(type ? { type: type as InventoryTxnType } : {}),
    ...(product ? { productId: product } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: fromIst(from) } : {}), ...(to ? { lt: fromIst(addDaysKey(to, 1)) } : {}) } } : {}),
  };
}

/** Report period from ?from=&to= (defaults: first of this month → today). */
export function reportRange(sp: SP) {
  const today = istDateKey();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(str(sp.from)) ? str(sp.from) : `${today.slice(0, 7)}-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(str(sp.to)) ? str(sp.to) : today;
  return { from, to, start: fromIst(from), end: fromIst(addDaysKey(to, 1)) };
}

export type ProfitRow = { productId: string; name: string; sku: string; unit: string; qty: number; revenue: number; cost: number; margin: number; marginPct: number | null };
export type UsageRow = { productId: string; product: string; unit: string; treatment: string; sessions: number; qty: number; cost: number; shortfall: number };
export type WriteOffRow = { type: string; productId: string; product: string; unit: string; qty: number; value: number };

/**
 * Product sales profit, treatment-wise usage and write-offs for a period.
 * Revenue uses the sale's unit price (falls back to product selling price when the sale didn't record one).
 * Cost uses the batch cost captured on the movement (falls back to product purchase price).
 */
export async function inventoryReport(branchIds: string[], start: Date, end: Date) {
  const txns = await db.inventoryTransaction.findMany({
    where: { branchId: { in: branchIds }, createdAt: { gte: start, lt: end }, type: { in: ["SALE", "CUSTOMER_RETURN", "TREATMENT_USAGE", "DAMAGE", "EXPIRED", "ADJUSTMENT_OUT", "RETURN_TO_SUPPLIER"] } },
    include: { product: { select: { id: true, name: true, sku: true, unit: true, purchasePrice: true, sellingPrice: true } } },
  });

  const profit = new Map<string, ProfitRow>();
  const usage = new Map<string, UsageRow & { _sessions: Set<string> }>();
  const writeOffs = new Map<string, WriteOffRow>();

  const sessionIds = [...new Set(txns.filter((t) => t.type === "TREATMENT_USAGE" && t.refType === "Session" && t.refId).map((t) => t.refId!))];
  const sessions = sessionIds.length
    ? await db.treatmentSession.findMany({ where: { id: { in: sessionIds } }, select: { id: true, treatment: { select: { name: true } } } })
    : [];
  const treatmentOf = new Map(sessions.map((s) => [s.id, s.treatment.name]));

  for (const t of txns) {
    const qty = Math.abs(toNum(t.quantity));
    const unitCost = t.unitCost !== null ? toNum(t.unitCost) : toNum(t.product.purchasePrice);
    if (t.type === "SALE" || t.type === "CUSTOMER_RETURN") {
      const sign = t.type === "SALE" ? 1 : -1;
      const price = t.unitPrice !== null ? toNum(t.unitPrice) : toNum(t.product.sellingPrice);
      const row = profit.get(t.productId) ?? { productId: t.productId, name: t.product.name, sku: t.product.sku, unit: t.product.unit, qty: 0, revenue: 0, cost: 0, margin: 0, marginPct: null };
      row.qty += sign * qty;
      row.revenue += sign * qty * price;
      row.cost += sign * qty * unitCost;
      profit.set(t.productId, row);
    } else if (t.type === "TREATMENT_USAGE") {
      const treatment = (t.refId && treatmentOf.get(t.refId)) || "Unlinked usage";
      const key = `${t.productId}:${treatment}`;
      const row = usage.get(key) ?? { productId: t.productId, product: t.product.name, unit: t.product.unit, treatment, sessions: 0, qty: 0, cost: 0, shortfall: 0, _sessions: new Set<string>() };
      row.qty += qty;
      row.cost += qty * unitCost;
      if (!t.batchId) row.shortfall += qty;
      if (t.refId) row._sessions.add(t.refId);
      usage.set(key, row);
    } else {
      const key = `${t.type}:${t.productId}`;
      const row = writeOffs.get(key) ?? { type: t.type, productId: t.productId, product: t.product.name, unit: t.product.unit, qty: 0, value: 0 };
      row.qty += qty;
      row.value += qty * unitCost;
      writeOffs.set(key, row);
    }
  }

  const profitRows = [...profit.values()]
    .map((r) => {
      const margin = r2(r.revenue - r.cost);
      return { ...r, qty: r2(r.qty), revenue: r2(r.revenue), cost: r2(r.cost), margin, marginPct: r.revenue > 0 ? r2((margin / r.revenue) * 100) : null };
    })
    .sort((a, b) => b.revenue - a.revenue);
  const usageRows: UsageRow[] = [...usage.values()]
    .map(({ _sessions, ...r }) => ({ ...r, sessions: _sessions.size, qty: r2(r.qty), cost: r2(r.cost), shortfall: r2(r.shortfall) }))
    .sort((a, b) => b.cost - a.cost);
  const writeOffRows = [...writeOffs.values()].map((r) => ({ ...r, qty: r2(r.qty), value: r2(r.value) })).sort((a, b) => b.value - a.value);

  return { profitRows, usageRows, writeOffRows };
}
