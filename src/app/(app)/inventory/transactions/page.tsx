import Link from "next/link";
import { Download } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { cn, fmtDateTime, fmtNum, toNum } from "@/lib/format";
import { PageHeader, Pagination, withParams } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { DateParam, FilterBar, SelectParam } from "@/components/ui/filters";
import { Table, TableEmpty, TD, TH, THead, TR } from "@/components/ui/table";
import { InventoryTabs } from "../_lib/nav";
import { TXN_LABEL, TXN_OPTIONS, TXN_TONE } from "../_lib/labels";
import { resolveRefs, userNames } from "../_lib/data";
import { txnWhere } from "../_lib/queries";

export const metadata = { title: "Stock movements" };
const PAGE_SIZE = 50;
type SP = Record<string, string | string[] | undefined>;

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("inventory.view");
  const scope = await getBranchScope();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = txnWhere(sp, scope.ids);
  const [total, txns, products] = await Promise.all([
    db.inventoryTransaction.count({ where }),
    db.inventoryTransaction.findMany({
      where,
      include: { product: { select: { id: true, name: true, unit: true } }, batch: { select: { batchNo: true } }, branch: { select: { code: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.product.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const [refOf, names] = await Promise.all([resolveRefs(txns), userNames(txns.map((t) => t.createdById))]);

  return (
    <>
      <PageHeader
        title="Products & Inventory"
        description="Complete history of every stock movement."
        actions={
          can(user, "reports.export") && (
            <a href={withParams("/api/inventory/export", sp, { export: "transactions", page: null })} className={buttonClass("outline")}>
              <Download className="h-4 w-4" /> Excel
            </a>
          )
        }
      />
      <InventoryTabs active="transactions" />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <FilterBar>
            <SelectParam name="type" placeholder="All movement types" options={TXN_OPTIONS} />
            <SelectParam name="product" placeholder="All products" options={products.map((p) => [p.id, p.name] as const)} />
            <DateParam name="from" label="From" />
            <DateParam name="to" label="To" />
          </FilterBar>
          <span className="text-sm text-muted">{fmtNum(total)} movements</span>
        </div>
        <Table>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Product</TH>
              <TH>Movement</TH>
              <TH className="text-right">Qty</TH>
              <TH className="hidden md:table-cell">Batch</TH>
              <TH className="hidden lg:table-cell">Reference / note</TH>
              <TH className="hidden xl:table-cell">By</TH>
            </tr>
          </THead>
          <tbody>
            {txns.length === 0 ? (
              <TableEmpty colSpan={7}>No stock movements match these filters.</TableEmpty>
            ) : (
              txns.map((t) => {
                const q = toNum(t.quantity);
                const ref = refOf(t.refType, t.refId);
                return (
                  <TR key={t.id}>
                    <TD className="whitespace-nowrap text-ink-2">
                      {fmtDateTime(t.createdAt)}
                      {scope.isAll && <span className="ml-1.5 text-[11px] text-muted">{t.branch.code}</span>}
                    </TD>
                    <TD>
                      <Link href={`/inventory/${t.product.id}`} className="font-medium hover:text-accent">
                        {t.product.name}
                      </Link>
                    </TD>
                    <TD>
                      <Badge tone={TXN_TONE[t.type] ?? "neutral"}>{TXN_LABEL[t.type] ?? t.type}</Badge>
                    </TD>
                    <TD className={cn("tabular text-right font-medium whitespace-nowrap", q >= 0 ? "text-success" : "text-ink")}>
                      {q > 0 ? "+" : "−"}
                      {fmtNum(Math.abs(q))} <span className="text-xs font-normal text-muted">{t.product.unit}</span>
                    </TD>
                    <TD className="hidden text-ink-2 md:table-cell">{t.batch?.batchNo ?? <span className="text-danger">untracked</span>}</TD>
                    <TD className="hidden max-w-80 lg:table-cell">
                      {ref && (
                        <Link href={ref.href} className="block truncate text-ink-2 hover:text-accent">
                          {ref.label}
                        </Link>
                      )}
                      {t.notes && <p className="truncate text-xs text-muted" title={t.notes}>{t.notes}</p>}
                      {!ref && !t.notes && <span className="text-muted">—</span>}
                    </TD>
                    <TD className="hidden text-muted xl:table-cell">{(t.createdById && names.get(t.createdById)) || "—"}</TD>
                  </TR>
                );
              })
            )}
          </tbody>
        </Table>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(p) => withParams("/inventory/transactions", sp, { page: p })} />
      </Card>
    </>
  );
}
