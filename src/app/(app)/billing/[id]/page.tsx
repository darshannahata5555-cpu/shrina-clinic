import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, Printer, Receipt } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { advanceBalance } from "@/lib/billing";
import { fmtDate, fmtDateTime, money, r2, toNum } from "@/lib/format";
import { PAYMENT_METHOD_LABEL } from "@/lib/status";
import { amountInWords } from "@/lib/invoice";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, DetailList, EmptyState } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { ApplyAdvanceDialog, CancelInvoiceDialog, CreditNoteDialog, RecordPaymentDialog } from "./invoice-dialogs";

export async function generateMetadata({ params }: PageProps<"/billing/[id]">) {
  const { id } = await params;
  const inv = await db.invoice.findUnique({ where: { id }, select: { number: true } });
  return { title: inv ? `Invoice ${inv.number}` : "Invoice" };
}

const KIND_LABEL: Record<string, string> = { TREATMENT: "Treatment", PACKAGE: "Package", PRODUCT: "Product", CONSULTATION: "Consultation", OTHER: "Other" };

export default async function InvoicePage({ params, searchParams }: PageProps<"/billing/[id]">) {
  const user = await requirePermission("billing.view");
  const scope = await getBranchScope();
  const { id } = await params;
  const { created } = await searchParams;
  const inv = await db.invoice.findFirst({
    where: { id, deletedAt: null, branchId: { in: scope.branches.map((b) => b.id) } },
    include: {
      patient: { select: { id: true, fullName: true, code: true, mobile: true, email: true } },
      branch: { select: { name: true, code: true } },
      items: { include: { package: { select: { id: true, code: true, completedSessions: true, totalSessions: true, status: true } } } },
      payments: { orderBy: { paidAt: "asc" } },
      creditNotes: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!inv) notFound();

  const userIds = [...new Set([inv.createdById, ...inv.payments.map((p) => p.receivedById), ...inv.creditNotes.map((c) => c.createdById)].filter(Boolean) as string[])];
  const [users, advance, logs] = await Promise.all([
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    advanceBalance(inv.patientId),
    db.auditLog.findMany({ where: { entityId: inv.id, entity: "Invoice" }, orderBy: { createdAt: "desc" }, take: 10, include: { user: { select: { name: true } } } }),
  ]);
  const U = new Map(users.map((u) => [u.id, u.name]));
  const balance = toNum(inv.balance);
  const paid = toNum(inv.paidAmount);
  const credited = toNum(inv.creditedAmount);
  const creditable = r2(toNum(inv.total) - credited);
  const cancelled = inv.status === "CANCELLED";
  const blockedPkg = inv.items.find((i) => i.package && i.package.completedSessions > 0)?.package;
  const cancelBlocked =
    paid > 0.009
      ? `${money(paid)} has been collected on this invoice. Refund it first using “Credit note / refund”, then cancel.`
      : blockedPkg
        ? `Package ${blockedPkg.code} already has ${blockedPkg.completedSessions} completed session(s). Issue a credit note instead of cancelling.`
        : null;

  return (
    <>
      <PageHeader
        title={`Invoice ${inv.number}`}
        back={{ href: "/billing", label: "Billing & Invoices" }}
        meta={
          <>
            <StatusBadge kind="invoice" status={inv.status} />
            <span className="text-[13px] text-muted">
              {fmtDate(inv.date)} · {inv.branch.name}
            </span>
          </>
        }
        actions={
          <>
            <LinkButton href={`/billing/${inv.id}/print`} variant="outline" target="_blank">
              <Printer className="h-4 w-4" /> Print / PDF
            </LinkButton>
            {!cancelled && can(user, "billing.create") && balance > 0 && advance > 0 && <ApplyAdvanceDialog invoiceId={inv.id} balance={balance} advance={advance} />}
            {!cancelled && can(user, "billing.create") && balance > 0 && <RecordPaymentDialog invoiceId={inv.id} balance={balance} />}
          </>
        }
      />

      {created && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-success/25 bg-success-soft px-4 py-3 text-sm text-success">
          <CircleCheck className="h-4 w-4" /> Invoice created{paid > 0 ? ` and ${money(paid)} received` : ""}.
        </div>
      )}
      {cancelled && (
        <div className="mb-5 rounded-xl border border-border bg-surface-3 px-4 py-3 text-sm text-ink-2">
          This invoice was cancelled{inv.cancelReason ? `: ${inv.cancelReason}` : "."}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Items" />
            <Table>
              <THead>
                <tr>
                  <TH>Item</TH>
                  <TH className="hidden text-right sm:table-cell">Qty × Rate</TH>
                  <TH className="hidden text-right md:table-cell">Discount</TH>
                  <TH className="hidden text-right md:table-cell">GST</TH>
                  <TH className="text-right">Amount</TH>
                </tr>
              </THead>
              <tbody>
                {inv.items.map((it) => (
                  <TR key={it.id}>
                    <TD>
                      <p className="font-medium">{it.description}</p>
                      <p className="text-xs text-muted">
                        {KIND_LABEL[it.kind]}
                        {it.hsnSac ? ` · ${it.kind === "PRODUCT" ? "HSN" : "SAC"} ${it.hsnSac}` : ""}
                        {it.package && (
                          <>
                            {" · "}
                            <Link href={`/treatments/packages/${it.package.id}`} className="text-accent hover:underline">
                              {it.package.code}
                            </Link>{" "}
                            ({it.package.completedSessions}/{it.package.totalSessions} done)
                          </>
                        )}
                      </p>
                      <p className="tabular text-xs text-muted sm:hidden">
                        {toNum(it.quantity)} × {money(it.unitPrice)}
                      </p>
                    </TD>
                    <TD className="tabular hidden text-right text-ink-2 sm:table-cell">
                      {toNum(it.quantity)} × {money(it.unitPrice)}
                    </TD>
                    <TD className="tabular hidden text-right text-ink-2 md:table-cell">{toNum(it.discount) ? `−${money(it.discount)}` : "—"}</TD>
                    <TD className="tabular hidden text-right text-ink-2 md:table-cell">
                      {toNum(it.gstRate)}% · {money(it.tax)}
                    </TD>
                    <TD className="tabular text-right font-medium">{money(it.total)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <CardBody className="border-t border-border">
              <div className="ml-auto max-w-xs space-y-1.5 text-sm">
                {[
                  ["Subtotal", money(inv.subtotal)],
                  ["Discount", toNum(inv.discountTotal) ? `−${money(inv.discountTotal)}` : money(0)],
                  ["Taxable value", money(inv.taxableAmount)],
                  ...(toNum(inv.igst) ? [["IGST", money(inv.igst)]] : [["CGST", money(inv.cgst)], ["SGST", money(inv.sgst)]]),
                  ...(toNum(inv.roundOff) ? [["Round off", money(inv.roundOff)]] : []),
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-ink-2">
                    <span>{k}</span>
                    <span className="tabular">{v}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                  <span>Total</span>
                  <span className="tabular">{money(inv.total)}</span>
                </div>
                <p className="text-right text-xs text-muted">{amountInWords(toNum(inv.total))}</p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Payments & refunds" description={`${inv.payments.length} transaction${inv.payments.length === 1 ? "" : "s"}`} />
            {inv.payments.length === 0 ? (
              <EmptyState icon={<Receipt className="h-5 w-5" />} title="No payments yet" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Receipt</TH>
                    <TH className="hidden sm:table-cell">Date</TH>
                    <TH>Method</TH>
                    <TH className="hidden md:table-cell">Received by</TH>
                    <TH className="text-right">Amount</TH>
                  </tr>
                </THead>
                <tbody>
                  {inv.payments.map((p) => (
                    <TR key={p.id}>
                      <TD>
                        <Link href={`/payments/${p.id}/print`} target="_blank" className="font-medium hover:text-accent">
                          {p.receiptNo}
                        </Link>
                        {p.reference && <p className="text-xs text-muted">{p.reference}</p>}
                      </TD>
                      <TD className="hidden text-ink-2 sm:table-cell">{fmtDateTime(p.paidAt)}</TD>
                      <TD>
                        {p.kind === "REFUND" ? <Badge tone="danger">Refund · {PAYMENT_METHOD_LABEL[p.method]}</Badge> : <span className="text-ink-2">{PAYMENT_METHOD_LABEL[p.method]}</span>}
                      </TD>
                      <TD className="hidden text-ink-2 md:table-cell">{(p.receivedById && U.get(p.receivedById)) ?? "—"}</TD>
                      <TD className={`tabular text-right font-medium ${p.kind === "REFUND" ? "text-danger" : ""}`}>
                        {p.kind === "REFUND" ? "−" : ""}
                        {money(p.amount)}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {inv.creditNotes.length > 0 && (
            <Card>
              <CardHeader title="Credit notes" />
              <Table>
                <THead>
                  <tr>
                    <TH>Number</TH>
                    <TH>Reason</TH>
                    <TH className="hidden sm:table-cell">Type</TH>
                    <TH className="text-right">Amount</TH>
                  </tr>
                </THead>
                <tbody>
                  {inv.creditNotes.map((c) => (
                    <TR key={c.id}>
                      <TD>
                        <p className="font-medium">{c.number}</p>
                        <p className="text-xs text-muted">
                          {fmtDate(c.createdAt)} · {(c.createdById && U.get(c.createdById)) ?? ""}
                        </p>
                      </TD>
                      <TD className="text-ink-2">{c.reason}</TD>
                      <TD className="hidden text-ink-2 sm:table-cell">{c.refundMethod ? `Refund · ${PAYMENT_METHOD_LABEL[c.refundMethod]}` : "Reduced amount due"}</TD>
                      <TD className="tabular text-right font-medium">{money(c.amount)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Balance" />
            <CardBody className="space-y-2 text-sm">
              {[
                ["Invoice total", money(inv.total)],
                ["Paid (net of refunds)", money(paid)],
                ...(credited ? [["Credited", money(credited)]] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-ink-2">
                  <span>{k}</span>
                  <span className="tabular">{v}</span>
                </div>
              ))}
              <div className="flex items-baseline justify-between border-t border-border pt-2">
                <span className="font-medium">Balance due</span>
                <span className={`tabular text-xl font-semibold ${balance > 0 ? "text-warning" : "text-success"}`}>{money(balance)}</span>
              </div>
              {advance > 0 && <p className="text-xs text-muted">Patient advance balance: {money(advance)}</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Patient" actions={<LinkButton href={`/patients/${inv.patient.id}?tab=billing`} variant="ghost" size="sm">Billing history →</LinkButton>} />
            <CardBody>
              <DetailList
                className="sm:grid-cols-1"
                items={[
                  ["Name", <Link key="n" href={`/patients/${inv.patient.id}`} className="font-medium hover:text-accent">{inv.patient.fullName}</Link>],
                  ["Patient ID", inv.patient.code],
                  ["Mobile", inv.patient.mobile],
                  ["Created by", (inv.createdById && U.get(inv.createdById)) ?? "—"],
                ]}
              />
              {inv.notes && <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink-2">{inv.notes}</p>}
            </CardBody>
          </Card>

          {!cancelled && (can(user, "billing.refund") || can(user, "billing.cancel")) && (
            <Card>
              <CardHeader title="Adjustments" />
              <CardBody className="flex flex-wrap gap-2">
                {can(user, "billing.refund") && creditable > 0 && (paid > 0 || balance > 0) && (
                  <CreditNoteDialog invoiceId={inv.id} balance={balance} paid={paid} creditable={creditable} />
                )}
                {can(user, "billing.cancel") && <CancelInvoiceDialog invoiceId={inv.id} number={inv.number} blocked={cancelBlocked} />}
              </CardBody>
            </Card>
          )}

          {logs.length > 0 && (
            <Card>
              <CardHeader title="Activity" />
              <CardBody>
                <ol className="space-y-3">
                  {logs.map((l) => (
                    <li key={l.id} className="text-[13px]">
                      <p className="text-ink">{l.summary}</p>
                      <p className="text-xs text-muted">
                        {l.user?.name ?? "System"} · {fmtDateTime(l.createdAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
