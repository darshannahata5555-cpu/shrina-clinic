import Link from "next/link";
import { Mail, Pencil, Phone, Plus, Truck } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { fmtDate, money, toNum } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { Card, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionButton } from "@/components/ui/form";
import { Table, TableEmpty, TD, TH, THead, TR } from "@/components/ui/table";
import { InventoryTabs } from "../_lib/nav";
import { SupplierForm } from "../forms";
import { deleteSupplierAction } from "../actions";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const user = await requirePermission("inventory.view");
  const scope = await getBranchScope();
  const canManage = can(user, "inventory.manage");
  const [suppliers, totals] = await Promise.all([
    db.supplier.findMany({
      where: { deletedAt: null },
      include: { _count: { select: { products: { where: { deletedAt: null } } } } },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    db.purchase.groupBy({ by: ["supplierId"], where: { branchId: { in: scope.ids } }, _sum: { totalAmount: true }, _count: true, _max: { purchaseDate: true } }),
  ]);
  const t = new Map(totals.map((x) => [x.supplierId, x]));

  return (
    <>
      <PageHeader
        title="Products & Inventory"
        description="Suppliers you buy products and consumables from."
        actions={
          canManage && (
            <Dialog title="Add supplier" trigger={<Button><Plus className="h-4 w-4" /> Add supplier</Button>}>
              <SupplierForm />
            </Dialog>
          )
        }
      />
      <InventoryTabs active="suppliers" />
      <Card>
        <Table>
          <THead>
            <tr>
              <TH>Supplier</TH>
              <TH className="hidden md:table-cell">Contact</TH>
              <TH className="hidden text-right sm:table-cell">Products</TH>
              <TH className="hidden text-right sm:table-cell">Purchases</TH>
              <TH className="text-right">Purchased</TH>
              <TH className="hidden lg:table-cell">Last purchase</TH>
              {canManage && <TH className="text-right">Actions</TH>}
            </tr>
          </THead>
          <tbody>
            {suppliers.length === 0 ? (
              <TableEmpty colSpan={7}>
                <EmptyState className="py-4" icon={<Truck className="h-5 w-5" />} title="No suppliers yet" />
              </TableEmpty>
            ) : (
              suppliers.map((s) => {
                const x = t.get(s.id);
                return (
                  <TR key={s.id} className={s.isActive ? "" : "opacity-60"}>
                    <TD>
                      <Link href={`/inventory/suppliers/${s.id}`} className="font-medium hover:text-accent">
                        {s.name}
                      </Link>
                      {!s.isActive && <Badge tone="neutral" className="ml-2">Inactive</Badge>}
                      <p className="text-xs text-muted">{s.gstin ?? "No GSTIN"}</p>
                    </TD>
                    <TD className="hidden md:table-cell">
                      <p className="text-ink-2">{s.contactPerson ?? "—"}</p>
                      <p className="flex flex-wrap gap-x-3 text-xs text-muted">
                        {s.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3 w-3" /> {s.phone}
                          </span>
                        )}
                        {s.email && (
                          <span className="inline-flex items-center gap-1">
                            <Mail className="h-3 w-3" /> {s.email}
                          </span>
                        )}
                      </p>
                    </TD>
                    <TD className="tabular hidden text-right text-ink-2 sm:table-cell">{s._count.products}</TD>
                    <TD className="tabular hidden text-right text-ink-2 sm:table-cell">{x?._count ?? 0}</TD>
                    <TD className="tabular text-right font-medium">{money(toNum(x?._sum.totalAmount), { decimals: false })}</TD>
                    <TD className="hidden text-ink-2 lg:table-cell">{x?._max.purchaseDate ? fmtDate(x._max.purchaseDate) : "—"}</TD>
                    {canManage && (
                      <TD className="text-right whitespace-nowrap">
                        <Dialog title={`Edit ${s.name}`} trigger={<Button variant="ghost" size="sm"><Pencil className="h-3.5 w-3.5" /> Edit</Button>}>
                          <SupplierForm values={s} />
                        </Dialog>
                        <ActionButton action={deleteSupplierAction} fields={{ id: s.id }} variant="ghost" confirm={`Delete supplier ${s.name}? Past purchases are kept.`}>
                          Delete
                        </ActionButton>
                      </TD>
                    )}
                  </TR>
                );
              })
            )}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
