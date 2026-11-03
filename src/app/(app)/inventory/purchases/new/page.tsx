import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { istDateKey, toNum } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { PurchaseForm } from "../purchase-form";

export const metadata = { title: "New purchase" };

export default async function NewPurchasePage() {
  const user = await requirePermission("inventory.manage");
  const scope = await getBranchScope();
  const [products, suppliers] = await Promise.all([
    db.product.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true, sku: true, unit: true, purchasePrice: true, supplierId: true }, orderBy: { name: "asc" } }),
    db.supplier.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader
        back={{ href: "/inventory/purchases", label: "Purchases" }}
        title="New purchase entry"
        description="Record a supplier bill. Stock is added to the receiving branch immediately, batch by batch."
      />
      <PurchaseForm
        products={products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, unit: p.unit, cost: toNum(p.purchasePrice), supplierId: p.supplierId }))}
        suppliers={suppliers.map((s) => [s.id, s.name])}
        branches={scope.branches.map((b) => [b.id, b.name])}
        defaultBranchId={scope.defaultBranchId}
        today={istDateKey()}
        canExpense={can(user, "expenses.create") || can(user, "expenses.approve")}
      />
    </>
  );
}
