import Link from "next/link";
import { AlertTriangle, Boxes, Download, Hourglass, Package, Plus, Truck } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { cn, fmtDate, fmtNum, money, moneyShort } from "@/lib/format";
import { PageHeader, Pagination, withParams } from "@/components/ui/page";
import { Card, EmptyState, StatCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton, buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FilterBar, SearchParamInput, SelectParam } from "@/components/ui/filters";
import { Table, TableEmpty, TD, TH, THead, TR } from "@/components/ui/table";
import { InventoryTabs } from "./_lib/nav";
import { expiryCutoff, loadStockRows, raiseStockAlerts } from "./_lib/data";
import { STOCK_STATUS } from "./_lib/labels";
import { ProductForm } from "./forms";

export const metadata = { title: "Products & Inventory" };

const PAGE_SIZE = 25;

type SP = Record<string, string | string[] | undefined>;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("inventory.view");
  const scope = await getBranchScope();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const category = typeof sp.category === "string" ? sp.category : "";
  const kind = typeof sp.kind === "string" ? sp.kind : "";
  const filter = typeof sp.filter === "string" ? sp.filter : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const canManage = can(user, "inventory.manage");

  const where: Prisma.ProductWhereInput = {
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }, { brand: { contains: q, mode: "insensitive" } }] } : {}),
    ...(category ? { category } : {}),
    ...(kind === "retail" ? { isRetail: true } : kind === "consumable" ? { isRetail: false } : {}),
    ...(filter === "inactive" ? { isActive: false } : {}),
  };

  const [allRows, categories, suppliers] = await Promise.all([
    loadStockRows(scope.ids),
    db.product.findMany({ where: { deletedAt: null }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
    db.supplier.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  // Alerts are evaluated on the whole catalogue (not the filtered view).
  await raiseStockAlerts(allRows, scope.branches.filter((b) => scope.ids.includes(b.id)));

  const filtered = await (async () => {
    const hasFilter = Object.keys(where).length > 0;
    if (!hasFilter) return allRows;
    const ids = new Set((await db.product.findMany({ where: { deletedAt: null, ...where }, select: { id: true } })).map((p) => p.id));
    return allRows.filter((r) => ids.has(r.id));
  })();
  const rows = filtered.filter((r) =>
    filter === "low" ? r.status !== "OK" && r.isActive : filter === "out" ? r.status === "OUT" : filter === "expiring" ? r.expiringBatches > 0 : true,
  );
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const active = allRows.filter((r) => r.isActive);
  const totalValue = active.reduce((s, r) => s + r.value, 0);
  const lowCount = active.filter((r) => r.status === "LOW").length;
  const outCount = active.filter((r) => r.status === "OUT").length;
  const expiringBatches = await db.productBatch.count({
    where: { branchId: { in: scope.ids }, quantity: { gt: 0 }, expiryDate: { lte: expiryCutoff() }, product: { deletedAt: null } },
  });
  const branchCols = scope.isAll ? scope.branches.filter((b) => scope.ids.includes(b.id)) : [];
  const supplierOpts = suppliers.map((s) => [s.id, s.name] as const);

  const exportHref = withParams("/api/inventory/export", sp, { export: "stock", page: null });

  return (
    <>
      <PageHeader
        title="Products & Inventory"
        description={`Stock across ${scope.current?.name ?? "all branches"} — treatments deduct product usage automatically when a session is completed.`}
        actions={
          <>
            {can(user, "reports.export") && (
              <a href={exportHref} className={buttonClass("outline")}>
                <Download className="h-4 w-4" /> Excel
              </a>
            )}
            {canManage && (
              <>
                <LinkButton href="/inventory/purchases/new" variant="outline">
                  <Truck className="h-4 w-4" /> New purchase
                </LinkButton>
                <Dialog size="lg" title="Add product" trigger={<Button><Plus className="h-4 w-4" /> Add product</Button>}>
                  <ProductForm suppliers={supplierOpts} />
                </Dialog>
              </>
            )}
          </>
        }
      />
      <InventoryTabs active="products" />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Stock value (at cost)" value={moneyShort(totalValue)} hint={`${active.length} active products`} icon={<Boxes className="h-[18px] w-[18px]" />} tone="accent" />
        <StatCard label="Low stock" value={fmtNum(lowCount)} hint="At or below minimum level" icon={<AlertTriangle className="h-[18px] w-[18px]" />} tone={lowCount ? "warning" : "success"} href="/inventory?filter=low" />
        <StatCard label="Out of stock" value={fmtNum(outCount)} hint="Needs reordering now" icon={<Package className="h-[18px] w-[18px]" />} tone={outCount ? "danger" : "success"} href="/inventory?filter=out" />
        <StatCard label="Expiring ≤ 60 days" value={fmtNum(expiringBatches)} hint="Batches incl. already expired" icon={<Hourglass className="h-[18px] w-[18px]" />} tone={expiringBatches ? "warning" : "success"} href="/inventory?filter=expiring" />
      </div>

      <Card>
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <FilterBar>
            <SearchParamInput placeholder="Search name, ID or brand" />
            <SelectParam name="category" placeholder="All categories" options={categories.map((c) => [c.category, c.category] as const)} />
            <SelectParam name="kind" placeholder="Retail & consumables" options={[["retail", "Retail (sold to patients)"], ["consumable", "Clinic consumables"]]} />
            <SelectParam name="filter" placeholder="All stock levels" options={[["low", "Low or out of stock"], ["out", "Out of stock"], ["expiring", "Expiring within 60 days"], ["inactive", "Inactive products"]]} />
          </FilterBar>
        </div>
        <Table>
          <THead>
            <tr>
              <TH>Product</TH>
              <TH className="hidden md:table-cell">Category</TH>
              {branchCols.map((b) => (
                <TH key={b.id} className="hidden text-right lg:table-cell">{b.code}</TH>
              ))}
              <TH className="text-right">{branchCols.length ? "Total" : "In stock"}</TH>
              <TH className="hidden text-right sm:table-cell">Min</TH>
              <TH>Status</TH>
              <TH className="hidden md:table-cell">Nearest expiry</TH>
              <TH className="hidden text-right lg:table-cell">Value (cost)</TH>
            </tr>
          </THead>
          <tbody>
            {shown.length === 0 ? (
              <TableEmpty colSpan={7 + branchCols.length}>
                <EmptyState className="py-4" icon={<Package className="h-5 w-5" />} title="No products match" description="Try clearing the filters." />
              </TableEmpty>
            ) : (
              shown.map((r) => {
                const [tone, label] = STOCK_STATUS[r.status];
                const expSoon = r.nearestExpiry && r.nearestExpiry <= expiryCutoff();
                const expired = r.nearestExpiry && r.nearestExpiry < new Date();
                return (
                  <TR key={r.id}>
                    <TD>
                      <Link href={`/inventory/${r.id}`} className="font-medium hover:text-accent">
                        {r.name}
                      </Link>
                      <p className="text-xs text-muted">
                        {r.sku}
                        {r.brand ? ` · ${r.brand}` : ""}
                        {r.isRetail ? " · Retail" : ""}
                        {!r.isActive ? " · Inactive" : ""}
                      </p>
                    </TD>
                    <TD className="hidden text-ink-2 md:table-cell">{r.category}</TD>
                    {branchCols.map((b) => (
                      <TD key={b.id} className={cn("tabular hidden text-right lg:table-cell", r.lowBranches.includes(b.id) ? "font-medium text-warning" : "text-ink-2")}>
                        {fmtNum(r.byBranch[b.id] ?? 0)}
                      </TD>
                    ))}
                    <TD className="tabular text-right font-medium whitespace-nowrap">
                      {fmtNum(r.stock)} <span className="text-xs font-normal text-muted">{r.unit}</span>
                    </TD>
                    <TD className="tabular hidden text-right text-muted sm:table-cell">{fmtNum(r.minStock)}</TD>
                    <TD>
                      <Badge tone={tone} dot>
                        {label}
                      </Badge>
                    </TD>
                    <TD className={cn("hidden whitespace-nowrap md:table-cell", expired ? "text-danger" : expSoon ? "text-warning" : "text-ink-2")}>
                      {r.nearestExpiry ? fmtDate(r.nearestExpiry) : "—"}
                      {r.expiringBatches > 0 && <span className="ml-1 text-[11px]">({r.expiringBatches} batch{r.expiringBatches > 1 ? "es" : ""})</span>}
                    </TD>
                    <TD className="tabular hidden text-right text-ink-2 lg:table-cell">{money(r.value, { decimals: false })}</TD>
                  </TR>
                );
              })
            )}
          </tbody>
        </Table>
        <Pagination page={page} pageSize={PAGE_SIZE} total={rows.length} hrefFor={(p) => withParams("/inventory", sp, { page: p })} />
      </Card>
      {!canManage && <p className="mt-3 text-xs text-muted">You can view stock. Ask a branch manager to record stock movements.</p>}
    </>
  );
}
