import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { notifyUsers } from "@/lib/notify";
import { fmtDate, fmtNum, istDayRange, r2, toNum } from "@/lib/format";
import { EXPIRY_WINDOW_DAYS } from "./labels";

export type StockStatus = "OK" | "LOW" | "OUT";

export type StockRow = {
  id: string;
  sku: string;
  name: string;
  category: string;
  brand: string | null;
  unit: string;
  isRetail: boolean;
  isActive: boolean;
  minStock: number;
  purchasePrice: number;
  sellingPrice: number;
  supplierName: string | null;
  stock: number;
  byBranch: Record<string, number>;
  value: number;
  nearestExpiry: Date | null;
  expiringBatches: number;
  status: StockStatus;
  /** branches (ids) where this product is at/below minimum */
  lowBranches: string[];
};

export const expiryCutoff = () => new Date(Date.now() + EXPIRY_WINDOW_DAYS * 86400000);

/**
 * Products with stock computed from batches in `branchIds`.
 * Status: OUT when total stock ≤ 0; LOW when any branch in scope is at/below the product's minimum.
 */
export async function loadStockRows(branchIds: string[], where: Prisma.ProductWhereInput = {}): Promise<StockRow[]> {
  const [products, batches] = await Promise.all([
    db.product.findMany({
      where: { deletedAt: null, ...where },
      include: { supplier: { select: { name: true } } },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    db.productBatch.findMany({
      where: { branchId: { in: branchIds }, quantity: { gt: 0 } },
      select: { productId: true, branchId: true, quantity: true, purchasePrice: true, expiryDate: true },
    }),
  ]);
  const cutoff = expiryCutoff();
  const byProduct = new Map<string, typeof batches>();
  for (const b of batches) {
    const list = byProduct.get(b.productId) ?? [];
    list.push(b);
    byProduct.set(b.productId, list);
  }

  return products.map((p) => {
    const list = byProduct.get(p.id) ?? [];
    const byBranch: Record<string, number> = Object.fromEntries(branchIds.map((id) => [id, 0]));
    let value = 0;
    let nearest: Date | null = null;
    let expiring = 0;
    for (const b of list) {
      const q = toNum(b.quantity);
      byBranch[b.branchId] = r2((byBranch[b.branchId] ?? 0) + q);
      value += q * toNum(b.purchasePrice);
      if (b.expiryDate) {
        if (!nearest || b.expiryDate < nearest) nearest = b.expiryDate;
        if (b.expiryDate <= cutoff) expiring++;
      }
    }
    const stock = r2(Object.values(byBranch).reduce((s, v) => s + v, 0));
    const min = toNum(p.minStock);
    const lowBranches = min > 0 ? branchIds.filter((id) => (byBranch[id] ?? 0) <= min) : [];
    const status: StockStatus = stock <= 0 ? "OUT" : lowBranches.length ? "LOW" : "OK";
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      brand: p.brand,
      unit: p.unit,
      isRetail: p.isRetail,
      isActive: p.isActive,
      minStock: min,
      purchasePrice: toNum(p.purchasePrice),
      sellingPrice: toNum(p.sellingPrice),
      supplierName: p.supplier?.name ?? null,
      stock,
      byBranch,
      value: r2(value),
      nearestExpiry: nearest,
      expiringBatches: expiring,
      status,
      lowBranches,
    };
  });
}

const LOW_TITLE = "Low stock alert";
const EXPIRY_TITLE = "Stock expiring soon";

/**
 * In-app alerts for low stock and expiring batches — at most once per product/branch/day.
 * Best-effort: failures never break the page.
 */
export async function raiseStockAlerts(rows: StockRow[], branches: { id: string; name: string }[]) {
  try {
    const { start } = istDayRange();
    const name = new Map(branches.map((b) => [b.id, b.name]));
    const wanted: { branchId: string; title: string; body: string; link: string }[] = [];
    for (const r of rows) {
      if (!r.isActive) continue;
      for (const bid of r.lowBranches) {
        wanted.push({
          branchId: bid,
          title: LOW_TITLE,
          body: `${r.name} at ${name.get(bid) ?? "branch"}: ${fmtNum(r.byBranch[bid] ?? 0)} ${r.unit} left (minimum ${fmtNum(r.minStock)})`,
          link: `/inventory/${r.id}`,
        });
      }
    }
    const expiring = await db.productBatch.findMany({
      where: { branchId: { in: branches.map((b) => b.id) }, quantity: { gt: 0 }, expiryDate: { lte: expiryCutoff() } },
      include: { product: { select: { id: true, name: true, unit: true, deletedAt: true } } },
    });
    for (const b of expiring) {
      if (b.product.deletedAt) continue;
      wanted.push({
        branchId: b.branchId,
        title: EXPIRY_TITLE,
        body: `${b.product.name} batch ${b.batchNo} at ${name.get(b.branchId) ?? "branch"} ${b.expiryDate! < new Date() ? "expired" : "expires"} on ${fmtDate(b.expiryDate)} (${fmtNum(toNum(b.quantity))} ${b.product.unit})`,
        link: `/inventory/${b.product.id}`,
      });
    }
    if (!wanted.length) return;
    const existing = await db.notification.findMany({
      where: { channel: "IN_APP", title: { in: [LOW_TITLE, EXPIRY_TITLE] }, createdAt: { gte: start } },
      select: { body: true },
      distinct: ["body"],
    });
    const seen = new Set(existing.map((e) => e.body));
    for (const w of wanted) {
      if (seen.has(w.body)) continue;
      seen.add(w.body);
      await notifyUsers({ permission: "inventory.manage", branchId: w.branchId, title: w.title, body: w.body, link: w.link });
    }
  } catch (e) {
    console.error("[inventory alerts]", e);
  }
}

/** Map refType/refId of an inventory transaction to an in-app link + label. */
export async function resolveRefs(txns: { refType: string | null; refId: string | null }[]) {
  const sessionIds = txns.filter((t) => t.refType === "Session" && t.refId).map((t) => t.refId!);
  const invoiceIds = txns.filter((t) => t.refType === "Invoice" && t.refId).map((t) => t.refId!);
  const purchaseIds = txns.filter((t) => t.refType === "Purchase" && t.refId).map((t) => t.refId!);
  const [sessions, invoices, purchases] = await Promise.all([
    sessionIds.length
      ? db.treatmentSession.findMany({ where: { id: { in: sessionIds } }, select: { id: true, patientId: true, patient: { select: { fullName: true } }, treatment: { select: { name: true } } } })
      : [],
    invoiceIds.length ? db.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, number: true } }) : [],
    purchaseIds.length ? db.purchase.findMany({ where: { id: { in: purchaseIds } }, select: { id: true, number: true } }) : [],
  ]);
  const map = new Map<string, { href: string; label: string }>();
  for (const s of sessions) map.set(`Session:${s.id}`, { href: `/patients/${s.patientId}?tab=packages`, label: `${s.patient.fullName} · ${s.treatment.name}` });
  for (const i of invoices) map.set(`Invoice:${i.id}`, { href: `/billing/${i.id}`, label: `Invoice ${i.number}` });
  for (const p of purchases) map.set(`Purchase:${p.id}`, { href: `/inventory/purchases/${p.id}`, label: p.number });
  return (refType: string | null, refId: string | null) => (refType && refId ? (map.get(`${refType}:${refId}`) ?? null) : null);
}

/** id → name for users who created records. */
export async function userNames(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter(Boolean) as string[])];
  if (!unique.length) return new Map<string, string>();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}
