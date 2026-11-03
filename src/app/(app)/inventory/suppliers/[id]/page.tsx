import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { fmtDate, money, toNum } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, DetailList, StatCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Table, TableEmpty, TD, TH, THead, TR } from "@/components/ui/table";
import { SupplierForm } from "../../forms";

export const metadata = { title: "Supplier" };

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("inventory.view");
  const scope = await getBranchScope();
  const { id } = await params;
  const s = await db.supplier.findFirst({ where: { id, deletedAt: null } });
  if (!s) notFound();
  const [purchases, products, agg] = await Promise.all([
    db.purchase.findMany({
      where: { supplierId: id, branchId: { in: scope.ids } },
      include: { branch: { select: { code: true } }, _count: { select: { items: true } } },
      orderBy: { purchaseDate: "desc" },
      take: 50,
    }),
    db.product.findMany({ where: { supplierId: id, deletedAt: null }, select: { id: true, name: true, sku: true, purchasePrice: true, unit: true }, orderBy: { name: "asc" } }),
    db.purchase.aggregate({ where: { supplierId: id, branchId: { in: scope.ids } }, _sum: { totalAmount: true }, _count: true }),
  ]);
  const canManage = can(user, "inventory.manage");

  return (
    <>
      <PageHeader
        back={{ href: "/inventory/suppliers", label: "Suppliers" }}
        title={s.name}
        meta={!s.isActive ? <Badge tone="neutral">Inactive</Badge> : undefined}
        actions={
          canManage && (
            <>
              <LinkButton href="/inventory/purchases/new" variant="outline">
                <Plus className="h-4 w-4" /> New purchase
              </LinkButton>
              <Dialog title={`Edit ${s.name}`} trigger={<Button variant="outline"><Pencil className="h-4 w-4" /> Edit</Button>}>
                <SupplierForm values={s} />
              </Dialog>
            </>
          )
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Total purchased" value={money(toNum(agg._sum.totalAmount), { decimals: false })} hint={scope.current?.name ?? "All branches"} />
        <StatCard label="Purchase entries" value={agg._count} />
        <StatCard label="Products supplied" value={products.length} className="col-span-2 md:col-span-1" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Purchase history" />
          <Table>
            <THead>
              <tr>
                <TH>Purchase</TH>
                <TH>Date</TH>
                <TH className="hidden sm:table-cell">Bill no.</TH>
                {scope.isAll && <TH className="hidden sm:table-cell">Branch</TH>}
                <TH className="hidden text-right sm:table-cell">Items</TH>
                <TH className="text-right">Total</TH>
              </tr>
            </THead>
            <tbody>
              {purchases.length === 0 ? (
                <TableEmpty colSpan={6}>No purchases from this supplier yet.</TableEmpty>
              ) : (
                purchases.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <Link href={`/inventory/purchases/${p.id}`} className="font-medium hover:text-accent">
                        {p.number}
                      </Link>
                    </TD>
                    <TD className="text-ink-2">{fmtDate(p.purchaseDate)}</TD>
                    <TD className="hidden text-ink-2 sm:table-cell">{p.billNo ?? "—"}</TD>
                    {scope.isAll && <TD className="hidden text-ink-2 sm:table-cell">{p.branch.code}</TD>}
                    <TD className="tabular hidden text-right text-ink-2 sm:table-cell">{p._count.items}</TD>
                    <TD className="tabular text-right font-medium">{money(p.totalAmount)}</TD>
                  </TR>
                ))
              )}
            </tbody>
          </Table>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Contact" />
            <CardBody>
              <DetailList
                className="sm:grid-cols-1"
                items={[
                  ["Contact person", s.contactPerson ?? "—"],
                  ["Phone", s.phone ?? "—"],
                  ["Email", s.email ?? "—"],
                  ["GSTIN", s.gstin ?? "—"],
                  ["Address", s.address ?? "—"],
                  ["Notes", s.notes ?? "—"],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Products" />
            {products.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">No products linked to this supplier.</p>
            ) : (
              <ul className="divide-y divide-border">
                {products.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                    <Link href={`/inventory/${p.id}`} className="truncate hover:text-accent">
                      {p.name}
                    </Link>
                    <span className="tabular shrink-0 text-muted">
                      {money(p.purchasePrice)}/{p.unit}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
