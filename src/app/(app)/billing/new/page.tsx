import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { getSetting } from "@/lib/settings";
import { pickedPatient, treatmentOptions } from "@/lib/lookups";
import { istDateKey, toNum } from "@/lib/format";
import { discountAllowance } from "@/lib/invoice";
import { PageHeader } from "@/components/ui/page";
import { InvoiceBuilder, type BuilderLine } from "./invoice-builder";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: PageProps<"/billing/new">) {
  const user = await requirePermission("billing.create");
  const scope = await getBranchScope();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;
  let patientId = one(sp.patientId);
  const packageId = one(sp.packageId);
  const appointmentId = one(sp.appointmentId);
  const branchIds = scope.branches.map((b) => b.id);

  const [billing, treatments, products, stockRows] = await Promise.all([
    getSetting("billing"),
    treatmentOptions(),
    db.product.findMany({
      where: { deletedAt: null, isActive: true, isRetail: true },
      select: { id: true, name: true, sku: true, unit: true, sellingPrice: true, gstRate: true, category: true },
      orderBy: { name: "asc" },
    }),
    db.productBatch.groupBy({ by: ["productId", "branchId"], where: { branchId: { in: branchIds } }, _sum: { quantity: true } }),
  ]);

  const stock: Record<string, Record<string, number>> = {};
  for (const r of stockRows) (stock[r.branchId] ??= {})[r.productId] = toNum(r._sum.quantity);

  // Prefill from a package or an appointment.
  const initialLines: BuilderLine[] = [];
  let branchId = scope.defaultBranchId;
  const unbilled = (id: string) =>
    db.treatmentPackage.findFirst({
      where: { id, deletedAt: null, status: { not: "CANCELLED" }, invoiceItems: { none: { invoice: { status: { not: "CANCELLED" }, deletedAt: null } } } },
    });
  if (packageId) {
    const pk = await unbilled(packageId);
    if (pk && branchIds.includes(pk.branchId)) {
      patientId ??= pk.patientId;
      branchId = pk.branchId;
      initialLines.push({ kind: "PACKAGE", pkgMode: "existing", packageId: pk.id, quantity: 1, unitPrice: toNum(pk.price) });
    }
  }
  if (appointmentId) {
    const ap = await db.appointment.findFirst({ where: { id: appointmentId, deletedAt: null, branchId: { in: branchIds } }, include: { treatment: true } });
    if (ap) {
      patientId ??= ap.patientId;
      branchId = ap.branchId;
      const pk = ap.packageId ? await unbilled(ap.packageId) : null;
      if (pk) initialLines.push({ kind: "PACKAGE", pkgMode: "existing", packageId: pk.id, quantity: 1, unitPrice: toNum(pk.price) });
      else if (ap.treatment && !ap.packageId) {
        if (ap.treatment.category === "Consultation")
          initialLines.push({ kind: "CONSULTATION", treatmentId: ap.treatment.id, description: ap.treatment.name, quantity: 1, unitPrice: toNum(ap.treatment.defaultPrice) });
        else initialLines.push({ kind: "TREATMENT", treatmentId: ap.treatment.id, quantity: 1, unitPrice: toNum(ap.treatment.defaultPrice) });
      }
    }
  }

  const patient = await pickedPatient(patientId);

  return (
    <>
      <PageHeader title="New invoice" description="Bill treatments, packages and products. GST is calculated automatically." back={{ href: "/billing", label: "Billing & Invoices" }} />
      <InvoiceBuilder
        patient={patient}
        branches={scope.branches.map((b) => ({ id: b.id, name: b.name }))}
        defaultBranchId={branchId ?? branchIds[0] ?? ""}
        today={istDateKey()}
        treatments={treatments.map((t) => ({ id: t.id, name: t.name, category: t.category, price: t.defaultPrice, gstRate: t.gstRate, sessions: t.defaultSessions }))}
        products={products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, unit: p.unit, price: toNum(p.sellingPrice), gstRate: toNum(p.gstRate) }))}
        stock={stock}
        billing={{
          gstEnabled: billing.gstEnabled,
          pricesIncludeGst: billing.pricesIncludeGst,
          roundOff: billing.roundOff,
          defaultServiceGst: billing.defaultServiceGst,
        }}
        canDiscount={can(user, "billing.discount")}
        discountLimit={discountAllowance({
          canDiscount: can(user, "billing.discount"),
          unlimited: user.roleKey === "OWNER" || can(user, "billing.refund"),
          maxPercent: billing.maxDiscountPercentWithoutApproval,
        })}
        initialLines={initialLines}
      />
    </>
  );
}
