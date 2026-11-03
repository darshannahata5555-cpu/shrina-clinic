import Link from "next/link";
import { Download } from "lucide-react";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { cn, fmtDate, fmtNum, money } from "@/lib/format";
import { PageHeader, withParams } from "@/components/ui/page";
import { Card, CardHeader, StatCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { DateParam, FilterBar } from "@/components/ui/filters";
import { Table, TableEmpty, TD, TH, THead, TR } from "@/components/ui/table";
import { InventoryTabs } from "../_lib/nav";
import { TXN_LABEL, TXN_TONE } from "../_lib/labels";
import { inventoryReport, reportRange } from "../_lib/queries";

export const metadata = { title: "Inventory reports" };
type SP = Record<string, string | string[] | undefined>;

export default async function InventoryReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("inventory.view");
  const scope = await getBranchScope();
  const sp = await searchParams;
  const range = reportRange(sp);
  const { profitRows, usageRows, writeOffRows } = await inventoryReport(scope.ids, range.start, range.end);

  const sales = profitRows.reduce((s, r) => s + r.revenue, 0);
  const cogs = profitRows.reduce((s, r) => s + r.cost, 0);
  const usageCost = usageRows.reduce((s, r) => s + r.cost, 0);
  const writeOff = writeOffRows.reduce((s, r) => s + r.value, 0);

  return (
    <>
      <PageHeader
        title="Products & Inventory"
        description={`${fmtDate(range.start)} – ${fmtDate(new Date(range.end.getTime() - 1))} · ${scope.current?.name ?? "All branches"}`}
        actions={
          can(user, "reports.export") && (
            <a href={withParams("/api/inventory/export", sp, { export: "report", from: range.from, to: range.to })} className={buttonClass("outline")}>
              <Download className="h-4 w-4" /> Excel
            </a>
          )
        }
      />
      <InventoryTabs active="reports" />
      <FilterBar className="mb-5">
        <DateParam name="from" label="From" />
        <DateParam name="to" label="To" />
        <span className="text-xs text-muted">Default: this month to date</span>
      </FilterBar>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Product sales (net of returns)" value={money(sales, { decimals: false })} tone="accent" />
        <StatCard label="Gross profit on products" value={money(sales - cogs, { decimals: false })} hint={sales > 0 ? `${fmtNum(((sales - cogs) / sales) * 100)}% margin` : "No sales in period"} tone="success" />
        <StatCard label="Used in treatments (cost)" value={money(usageCost, { decimals: false })} tone="violet" />
        <StatCard label="Write-offs (cost)" value={money(writeOff, { decimals: false })} hint="Damaged, expired, adjustments, returns" tone={writeOff ? "danger" : "neutral"} />
      </div>

      <Card className="mb-5">
        <CardHeader title="Product profit" description="Retail product sales — revenue at sale price, cost at batch cost" />
        <Table>
          <THead>
            <tr>
              <TH>Product</TH>
              <TH className="text-right">Qty sold</TH>
              <TH className="text-right">Revenue</TH>
              <TH className="hidden text-right sm:table-cell">Cost</TH>
              <TH className="text-right">Profit</TH>
              <TH className="hidden text-right md:table-cell">Margin</TH>
            </tr>
          </THead>
          <tbody>
            {profitRows.length === 0 ? (
              <TableEmpty colSpan={6}>No product sales in this period.</TableEmpty>
            ) : (
              profitRows.map((r) => (
                <TR key={r.productId}>
                  <TD>
                    <Link href={`/inventory/${r.productId}`} className="font-medium hover:text-accent">
                      {r.name}
                    </Link>
                    <p className="text-xs text-muted">{r.sku}</p>
                  </TD>
                  <TD className="tabular text-right">
                    {fmtNum(r.qty)} <span className="text-xs text-muted">{r.unit}</span>
                  </TD>
                  <TD className="tabular text-right">{money(r.revenue)}</TD>
                  <TD className="tabular hidden text-right text-ink-2 sm:table-cell">{money(r.cost)}</TD>
                  <TD className={cn("tabular text-right font-medium", r.margin < 0 && "text-danger")}>{money(r.margin)}</TD>
                  <TD className="tabular hidden text-right text-ink-2 md:table-cell">{r.marginPct === null ? "—" : `${fmtNum(r.marginPct)}%`}</TD>
                </TR>
              ))
            )}
          </tbody>
        </Table>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Treatment-wise product usage" description="Deducted automatically when sessions were completed" />
          <Table>
            <THead>
              <tr>
                <TH>Treatment</TH>
                <TH>Product</TH>
                <TH className="hidden text-right sm:table-cell">Sessions</TH>
                <TH className="text-right">Used</TH>
                <TH className="text-right">Cost</TH>
              </tr>
            </THead>
            <tbody>
              {usageRows.length === 0 ? (
                <TableEmpty colSpan={5}>No treatment usage recorded in this period.</TableEmpty>
              ) : (
                usageRows.map((r) => (
                  <TR key={`${r.productId}:${r.treatment}`}>
                    <TD className="font-medium">{r.treatment}</TD>
                    <TD>
                      <Link href={`/inventory/${r.productId}`} className="text-ink-2 hover:text-accent">
                        {r.product}
                      </Link>
                      {r.shortfall > 0 && <p className="text-xs text-danger">{fmtNum(r.shortfall)} {r.unit} used without stock</p>}
                    </TD>
                    <TD className="tabular hidden text-right text-ink-2 sm:table-cell">{r.sessions}</TD>
                    <TD className="tabular text-right">
                      {fmtNum(r.qty)} <span className="text-xs text-muted">{r.unit}</span>
                    </TD>
                    <TD className="tabular text-right">{money(r.cost)}</TD>
                  </TR>
                ))
              )}
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Damaged, expired & other write-offs" description="Stock removed without a sale, valued at cost" />
          <Table>
            <THead>
              <tr>
                <TH>Reason</TH>
                <TH>Product</TH>
                <TH className="text-right">Qty</TH>
                <TH className="text-right">Value</TH>
              </tr>
            </THead>
            <tbody>
              {writeOffRows.length === 0 ? (
                <TableEmpty colSpan={4}>No write-offs in this period.</TableEmpty>
              ) : (
                writeOffRows.map((r) => (
                  <TR key={`${r.type}:${r.productId}`}>
                    <TD>
                      <Badge tone={TXN_TONE[r.type] ?? "neutral"}>{TXN_LABEL[r.type]}</Badge>
                    </TD>
                    <TD>
                      <Link href={`/inventory/${r.productId}`} className="hover:text-accent">
                        {r.product}
                      </Link>
                    </TD>
                    <TD className="tabular text-right">
                      {fmtNum(r.qty)} <span className="text-xs text-muted">{r.unit}</span>
                    </TD>
                    <TD className="tabular text-right font-medium">{money(r.value)}</TD>
                  </TR>
                ))
              )}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
