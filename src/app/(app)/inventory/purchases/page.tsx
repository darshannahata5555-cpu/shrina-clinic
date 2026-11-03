import Link from "next/link";
import { Plus, Truck } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { fmtDate, fromIst, addDaysKey, money, toNum } from "@/lib/format";
import { PageHeader, Pagination, withParams } from "@/components/ui/page";
import { Card, EmptyState } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { DateParam, FilterBar, SearchParamInput, SelectParam } from "@/components/ui/filters";
import { Table, TableEmpty, TD, TH, THead, TR } from "@/components/ui/table";
import { InventoryTabs } from "../_lib/nav";

export const metadata = { title: "Purchases" };
const PAGE_SIZE = 25;
type SP = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("inventory.view");
  const scope = await getBranchScope();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supplier = str(sp.supplier);
  const from = str(sp.from);
  const to = str(sp.to);
  const q = str(sp.q).trim();

  const where: Prisma.PurchaseWhereInput = {
    branchId: { in: scope.ids },
    ...(supplier ? { supplierId: supplier } : {}),
    ...(from || to
      ? { purchaseDate: { ...(from ? { gte: fromIst(from) } : {}), ...(to ? { lt: fromIst(addDaysKey(to, 1)) } : {}) } }
      : {}),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { billNo: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [total, sum, purchases, suppliers] = await Promise.all([
    db.purchase.count({ where }),
    db.purchase.aggregate({ where, _sum: { totalAmount: true } }),
    db.purchase.findMany({
      where,
      include: { supplier: { select: { id: true, name: true } }, branch: { select: { code: true } }, _count: { select: { items: true } } },
      orderBy: { purchaseDate: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.supplier.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="Products & Inventory"
        description="Supplier bills recorded as purchase entries."
        actions={
          can(user, "inventory.manage") && (
            <LinkButton href="/inventory/purchases/new">
              <Plus className="h-4 w-4" /> New purchase
            </LinkButton>
          )
        }
      />
      <InventoryTabs active="purchases" />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <FilterBar>
            <SearchParamInput placeholder="Purchase or bill no." />
            <SelectParam name="supplier" placeholder="All suppliers" options={suppliers.map((s) => [s.id, s.name] as const)} />
            <DateParam name="from" label="From" />
            <DateParam name="to" label="To" />
          </FilterBar>
          <p className="text-sm text-muted">
            {total} purchase{total === 1 ? "" : "s"} · <span className="tabular font-medium text-ink">{money(sum._sum.totalAmount, { decimals: false })}</span>
          </p>
        </div>
        <Table>
          <THead>
            <tr>
              <TH>Purchase</TH>
              <TH>Date</TH>
              <TH>Supplier</TH>
              <TH className="hidden md:table-cell">Bill no.</TH>
              {scope.isAll && <TH className="hidden sm:table-cell">Branch</TH>}
              <TH className="hidden text-right sm:table-cell">Items</TH>
              <TH className="text-right">Total</TH>
            </tr>
          </THead>
          <tbody>
            {purchases.length === 0 ? (
              <TableEmpty colSpan={7}>
                <EmptyState className="py-4" icon={<Truck className="h-5 w-5" />} title="No purchases found" description="Record supplier bills to add stock batch-wise." />
              </TableEmpty>
            ) : (
              purchases.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <Link href={`/inventory/purchases/${p.id}`} className="font-medium hover:text-accent">
                      {p.number}
                    </Link>
                  </TD>
                  <TD className="whitespace-nowrap text-ink-2">{fmtDate(p.purchaseDate)}</TD>
                  <TD>
                    <Link href={`/inventory/suppliers/${p.supplier.id}`} className="text-ink-2 hover:text-accent">
                      {p.supplier.name}
                    </Link>
                  </TD>
                  <TD className="hidden text-ink-2 md:table-cell">{p.billNo ?? "—"}</TD>
                  {scope.isAll && <TD className="hidden text-ink-2 sm:table-cell">{p.branch.code}</TD>}
                  <TD className="tabular hidden text-right text-ink-2 sm:table-cell">{p._count.items}</TD>
                  <TD className="tabular text-right font-medium">{money(toNum(p.totalAmount))}</TD>
                </TR>
              ))
            )}
          </tbody>
        </Table>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(p) => withParams("/inventory/purchases", sp, { page: p })} />
      </Card>
    </>
  );
}
