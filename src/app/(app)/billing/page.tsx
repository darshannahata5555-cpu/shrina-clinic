import Link from "next/link";
import { Download, FileMinus, Plus, Receipt } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { fmtDate, money, moneyShort, toNum } from "@/lib/format";
import { PAYMENT_METHOD_LABEL } from "@/lib/status";
import { PageHeader, Pagination, withParams } from "@/components/ui/page";
import { Card, EmptyState, StatCard } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { DateParam, FilterBar, SearchParamInput, SelectParam } from "@/components/ui/filters";
import { INVOICE_STATUS_FILTER, invoiceWhere, one } from "./_lib/filters";

export const metadata = { title: "Billing & Invoices" };
const PAGE = 25;

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  const user = await requirePermission("billing.view");
  const scope = await getBranchScope();
  const sp = await searchParams;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const where = invoiceWhere(sp, scope.ids);
  const live = { ...where, AND: [{ status: { not: "CANCELLED" as const } }] };

  const [rows, count, agg] = await Promise.all([
    db.invoice.findMany({
      where,
      include: {
        patient: { select: { id: true, fullName: true, code: true } },
        branch: { select: { code: true } },
        payments: { select: { method: true, kind: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ date: "desc" }, { number: "desc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
    }),
    db.invoice.count({ where }),
    db.invoice.aggregate({ where: live, _sum: { total: true, paidAmount: true, balance: true }, _count: true }),
  ]);
  const exportHref = withParams("/api/billing/export", sp, { page: null });

  return (
    <>
      <PageHeader
        title="Billing & Invoices"
        description="GST invoices for treatments, packages and products — with payments, credit notes and outstanding balances."
        actions={
          <>
            <LinkButton href="/billing/credit-notes" variant="ghost">
              <FileMinus className="h-4 w-4" /> Credit notes
            </LinkButton>
            {can(user, "reports.export") && (
              <LinkButton href={exportHref} variant="outline" prefetch={false}>
                <Download className="h-4 w-4" /> Excel
              </LinkButton>
            )}
            {can(user, "billing.create") && (
              <LinkButton href="/billing/new">
                <Plus className="h-4 w-4" /> New invoice
              </LinkButton>
            )}
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Invoices" value={agg._count} hint="Excluding cancelled" />
        <StatCard label="Billed" value={moneyShort(agg._sum.total)} hint={money(agg._sum.total, { decimals: false })} />
        <StatCard label="Collected" value={moneyShort(agg._sum.paidAmount)} hint="Net of refunds" tone="success" />
        <StatCard label="Outstanding" value={moneyShort(agg._sum.balance)} hint={<Link href="/payments/outstanding" className="hover:text-accent">Patient-wise dues →</Link>} tone="warning" />
      </div>

      <Card>
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <FilterBar>
            <SearchParamInput placeholder="Invoice no., patient, mobile…" />
            <SelectParam name="status" options={INVOICE_STATUS_FILTER} placeholder="Any status" />
            <SelectParam name="method" options={Object.entries(PAYMENT_METHOD_LABEL)} placeholder="Any payment method" />
            {scope.isAll && scope.branches.length > 1 && <SelectParam name="branch" options={scope.branches.map((b) => [b.id, b.name] as const)} placeholder="All branches" />}
            <DateParam name="from" label="From" />
            <DateParam name="to" label="To" />
          </FilterBar>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<Receipt className="h-5 w-5" />} title="No invoices match" description="Try clearing filters, or create a new invoice." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Invoice</TH>
                <TH>Patient</TH>
                <TH className="hidden lg:table-cell">Paid by</TH>
                <TH className="text-right">Total</TH>
                <TH className="hidden text-right sm:table-cell">Balance</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((inv) => {
                const methods = [...new Set(inv.payments.filter((p) => p.kind === "RECEIPT").map((p) => PAYMENT_METHOD_LABEL[p.method]))];
                return (
                  <TR key={inv.id}>
                    <TD>
                      <Link href={`/billing/${inv.id}`} className="font-medium hover:text-accent">
                        {inv.number}
                      </Link>
                      <p className="text-xs text-muted">
                        {fmtDate(inv.date)} · {inv._count.items} item{inv._count.items === 1 ? "" : "s"}
                        {scope.isAll && <> · {inv.branch.code}</>}
                      </p>
                    </TD>
                    <TD>
                      <Link href={`/patients/${inv.patient.id}?tab=billing`} className="hover:text-accent">
                        {inv.patient.fullName}
                      </Link>
                      <p className="text-xs text-muted">{inv.patient.code}</p>
                    </TD>
                    <TD className="hidden text-ink-2 lg:table-cell">{methods.length ? methods.join(", ") : <span className="text-muted">—</span>}</TD>
                    <TD className="tabular text-right font-medium">{money(inv.total)}</TD>
                    <TD className={`tabular hidden text-right sm:table-cell ${toNum(inv.balance) > 0 && inv.status !== "CANCELLED" ? "text-warning" : "text-muted"}`}>
                      {inv.status === "CANCELLED" ? "—" : money(inv.balance)}
                    </TD>
                    <TD>
                      <StatusBadge kind="invoice" status={inv.status} />
                      {toNum(inv.creditedAmount) > 0 && (
                        <Badge tone="neutral" className="ml-1 hidden xl:inline-flex">
                          CN {money(inv.creditedAmount, { decimals: false })}
                        </Badge>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={count} hrefFor={(p) => withParams("/billing", sp, { page: p })} />
      </Card>
    </>
  );
}
