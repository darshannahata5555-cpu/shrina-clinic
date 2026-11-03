import Link from "next/link";
import { Plus, Receipt } from "lucide-react";
import { db } from "@/lib/db";
import { can, type CurrentUser } from "@/lib/auth";
import { patientFinancials } from "@/lib/billing";
import { fmtDate, money } from "@/lib/format";
import { PAYMENT_METHOD_LABEL } from "@/lib/status";
import { Card, CardHeader, EmptyState, StatCard } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Table, THead, TH, TR, TD, TableEmpty } from "@/components/ui/table";

export async function BillingTab({ patientId, user }: { patientId: string; user: CurrentUser }) {
  const [fin, invoices, payments, creditNotes] = await Promise.all([
    patientFinancials(patientId),
    db.invoice.findMany({
      where: { patientId, deletedAt: null },
      include: { items: { select: { description: true } }, branch: { select: { code: true } } },
      orderBy: { date: "desc" },
    }),
    db.payment.findMany({ where: { patientId }, include: { invoice: { select: { id: true, number: true } } }, orderBy: { paidAt: "desc" } }),
    db.creditNote.findMany({ where: { patientId }, include: { invoice: { select: { id: true, number: true } } }, orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total billed" value={money(fin.billed, { decimals: false })} hint={`${fin.invoices} invoice${fin.invoices === 1 ? "" : "s"}`} />
        <StatCard label="Paid" value={money(fin.paid, { decimals: false })} tone="success" />
        <StatCard label="Pending balance" value={money(fin.outstanding, { decimals: false })} hint={fin.outstanding > 0 ? "Collect at next visit" : "Nothing due"} />
        <StatCard label="Advance balance" value={money(fin.advance, { decimals: false })} hint="Can be applied to new invoices" />
      </div>

      <Card>
        <CardHeader
          title="Invoices"
          actions={
            can(user, "billing.create") && (
              <>
                <LinkButton href={`/payments/new?patientId=${patientId}`} variant="outline" size="sm">
                  Record payment / advance
                </LinkButton>
                <LinkButton href={`/billing/new?patientId=${patientId}`} size="sm">
                  <Plus className="h-3.5 w-3.5" /> New invoice
                </LinkButton>
              </>
            )
          }
        />
        {invoices.length === 0 ? (
          <EmptyState icon={<Receipt className="h-5 w-5" />} title="No invoices yet" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Invoice</TH>
                <TH className="hidden md:table-cell">Items</TH>
                <TH className="text-right">Total</TH>
                <TH className="hidden text-right sm:table-cell">Paid</TH>
                <TH className="text-right">Balance</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <tbody>
              {invoices.map((i) => (
                <TR key={i.id}>
                  <TD>
                    <Link href={`/billing/${i.id}`} className="font-medium hover:text-accent">
                      {i.number}
                    </Link>
                    <p className="text-xs text-muted">
                      {fmtDate(i.date)} · {i.branch.code}
                    </p>
                  </TD>
                  <TD className="hidden max-w-xs truncate text-ink-2 md:table-cell">{i.items.map((x) => x.description).join(", ")}</TD>
                  <TD className="tabular text-right">{money(i.total)}</TD>
                  <TD className="tabular hidden text-right text-ink-2 sm:table-cell">{money(i.paidAmount)}</TD>
                  <TD className={`tabular text-right ${Number(i.balance) > 0 && i.status !== "CANCELLED" ? "font-medium text-warning" : "text-muted"}`}>{money(i.balance)}</TD>
                  <TD>
                    <StatusBadge kind="invoice" status={i.status} />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Payment history" description="Receipts, advances and refunds" />
        <Table>
          <THead>
            <tr>
              <TH>Receipt</TH>
              <TH>Date</TH>
              <TH className="hidden sm:table-cell">Method</TH>
              <TH className="hidden md:table-cell">Against</TH>
              <TH className="text-right">Amount</TH>
            </tr>
          </THead>
          <tbody>
            {payments.length === 0 && <TableEmpty colSpan={5}>No payments recorded.</TableEmpty>}
            {payments.map((p) => (
              <TR key={p.id}>
                <TD className="font-medium">
                  {p.receiptNo}
                  {p.kind === "REFUND" && <Badge tone="danger" className="ml-1.5">Refund</Badge>}
                </TD>
                <TD className="whitespace-nowrap text-ink-2">{fmtDate(p.paidAt)}</TD>
                <TD className="hidden text-ink-2 sm:table-cell">
                  {PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                  {p.reference && <span className="block text-xs text-muted">{p.reference}</span>}
                </TD>
                <TD className="hidden md:table-cell">
                  {p.invoice ? (
                    <Link href={`/billing/${p.invoice.id}`} className="text-ink-2 hover:text-accent">
                      {p.invoice.number}
                    </Link>
                  ) : (
                    <Badge tone="info">Advance</Badge>
                  )}
                </TD>
                <TD className={`tabular text-right font-medium ${p.kind === "REFUND" ? "text-danger" : "text-ink"}`}>
                  {p.kind === "REFUND" ? "−" : ""}
                  {money(p.amount)}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>

      {creditNotes.length > 0 && (
        <Card>
          <CardHeader title="Credit notes" />
          <Table>
            <THead>
              <tr>
                <TH>Credit note</TH>
                <TH>Invoice</TH>
                <TH className="hidden sm:table-cell">Reason</TH>
                <TH className="text-right">Amount</TH>
              </tr>
            </THead>
            <tbody>
              {creditNotes.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium">
                    {c.number}
                    <p className="text-xs font-normal text-muted">{fmtDate(c.createdAt)}</p>
                  </TD>
                  <TD>
                    <Link href={`/billing/${c.invoice.id}`} className="text-ink-2 hover:text-accent">
                      {c.invoice.number}
                    </Link>
                  </TD>
                  <TD className="hidden text-ink-2 sm:table-cell">{c.reason}</TD>
                  <TD className="tabular text-right">{money(c.amount)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
