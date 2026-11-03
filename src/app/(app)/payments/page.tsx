import Link from "next/link";
import { Banknote, CircleCheck, Download, Hourglass, Plus, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { fmtDate, fmtDateTime, fmtTime, istDateKey, istDayRange, money, moneyShort, toNum } from "@/lib/format";
import { PAYMENT_METHOD_LABEL } from "@/lib/status";
import { PageHeader, Pagination, withParams } from "@/components/ui/page";
import { Card, CardBody, CardHeader, EmptyState, StatCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { DateParam, FilterBar, SearchParamInput, SelectParam } from "@/components/ui/filters";
import { one, paymentWhere } from "../billing/_lib/filters";

export const metadata = { title: "Payments" };
const PAGE = 25;
const METHOD_ORDER = ["CASH", "UPI", "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "ONLINE"] as const;

export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const user = await requirePermission("billing.view");
  const scope = await getBranchScope();
  const sp = await searchParams;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const where = paymentWhere(sp, scope.ids);
  const branchParam = one(sp.branch);
  const dayIds = branchParam && scope.ids.includes(branchParam) ? [branchParam] : scope.ids;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(one(sp.day)) ? one(sp.day) : istDateKey();
  const { start, end } = istDayRange(day);
  const created = one(sp.created);

  const [rows, count, sums, dayRows, createdPay] = await Promise.all([
    db.payment.findMany({
      where,
      include: {
        patient: { select: { id: true, fullName: true, code: true } },
        invoice: { select: { id: true, number: true } },
        branch: { select: { code: true } },
      },
      orderBy: { paidAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
    }),
    db.payment.count({ where }),
    db.payment.groupBy({ by: ["kind", "method"], where, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["kind", "method"], where: { branchId: { in: dayIds }, paidAt: { gte: start, lt: end } }, _sum: { amount: true }, _count: true }),
    created ? db.payment.findFirst({ where: { id: created, branchId: { in: scope.branches.map((b) => b.id) } }, select: { id: true, receiptNo: true, amount: true, kind: true } }) : null,
  ]);

  const receivedById = [...new Set(rows.map((r) => r.receivedById).filter(Boolean) as string[])];
  const users = await db.user.findMany({ where: { id: { in: receivedById } }, select: { id: true, name: true } });
  const U = new Map(users.map((u) => [u.id, u.name]));

  const cashIn = sums.filter((s) => s.kind === "RECEIPT" && s.method !== "ADVANCE").reduce((a, s) => a + toNum(s._sum.amount), 0);
  const refunds = sums.filter((s) => s.kind === "REFUND").reduce((a, s) => a + toNum(s._sum.amount), 0);
  const adjusted = sums.filter((s) => s.kind === "RECEIPT" && s.method === "ADVANCE").reduce((a, s) => a + toNum(s._sum.amount), 0);

  const dayBy = (kind: "RECEIPT" | "REFUND", method: string) => {
    const r = dayRows.find((x) => x.kind === kind && x.method === method);
    return { amt: toNum(r?._sum.amount), n: r?._count ?? 0 };
  };
  const dayLines = METHOD_ORDER.map((m) => {
    const rc = dayBy("RECEIPT", m);
    const rf = dayBy("REFUND", m);
    return { method: m, receipts: rc.amt, count: rc.n, refunds: rf.amt, net: rc.amt - rf.amt };
  });
  const dayNet = dayLines.reduce((a, l) => a + l.net, 0);
  const cashDrawer = dayLines.find((l) => l.method === "CASH")!.net;
  const dayAdvanceUsed = dayBy("RECEIPT", "ADVANCE").amt;

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every receipt, advance and refund — with a daily collection summary for cash reconciliation."
        actions={
          <>
            <LinkButton href="/payments/outstanding" variant="outline">
              <Hourglass className="h-4 w-4" /> Outstanding
            </LinkButton>
            {can(user, "reports.export") && (
              <LinkButton href={withParams("/api/billing/export", sp, { type: "payments", page: null, created: null, day: null })} variant="outline" prefetch={false}>
                <Download className="h-4 w-4" /> Excel
              </LinkButton>
            )}
            {can(user, "billing.create") && (
              <LinkButton href="/payments/new">
                <Plus className="h-4 w-4" /> Record payment
              </LinkButton>
            )}
          </>
        }
      />

      {createdPay && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-success/25 bg-success-soft px-4 py-3 text-sm text-success">
          <CircleCheck className="h-4 w-4" />
          {createdPay.kind === "REFUND" ? "Refund" : "Payment"} {createdPay.receiptNo} for {money(createdPay.amount)} saved.
          <Link href={`/payments/${createdPay.id}/print`} target="_blank" className="font-medium underline">
            Print receipt
          </Link>
        </div>
      )}

      <div className="mb-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid grid-cols-2 content-start gap-3 md:grid-cols-4 xl:grid-cols-2">
          <StatCard label="Received" value={moneyShort(cashIn)} hint="Matching the filters below" icon={<Wallet className="h-[18px] w-[18px]" />} tone="success" />
          <StatCard label="Refunded" value={moneyShort(refunds)} hint="Invoice & advance refunds" tone="danger" />
          <StatCard label="Net collection" value={moneyShort(cashIn - refunds)} hint={money(cashIn - refunds, { decimals: false })} tone="accent" />
          <StatCard label="Adjusted from advance" value={moneyShort(adjusted)} hint="Non-cash — already counted when received" />
        </div>

        <Card>
          <CardHeader
            title={`Collection · ${day === istDateKey() ? "today" : fmtDate(start)}`}
            description="Day-end reconciliation by payment method"
            actions={<DateParam name="day" />}
          />
          <CardBody className="space-y-1.5 text-sm">
            {dayLines.map((l) => (
              <div key={l.method} className="flex items-baseline justify-between gap-3">
                <span className="text-ink-2">
                  {PAYMENT_METHOD_LABEL[l.method]} <span className="text-xs text-muted">({l.count})</span>
                </span>
                <span className="tabular">
                  {l.refunds > 0 && <span className="mr-2 text-xs text-danger">−{money(l.refunds, { decimals: false })}</span>}
                  {money(l.net)}
                </span>
              </div>
            ))}
            <div className="flex justify-between border-t border-border pt-2 font-semibold">
              <span>Total collected</span>
              <span className="tabular">{money(dayNet)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between rounded-lg bg-accent-soft px-3 py-2.5 text-accent">
              <span className="flex items-center gap-2 font-medium">
                <Banknote className="h-4 w-4" /> Expected cash in drawer
              </span>
              <span className="tabular text-base font-semibold">{money(cashDrawer)}</span>
            </div>
            {dayAdvanceUsed > 0 && <p className="text-xs text-muted">Plus {money(dayAdvanceUsed)} adjusted from patient advances (no money received).</p>}
          </CardBody>
        </Card>
      </div>

      <Card>
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <FilterBar>
            <SearchParamInput placeholder="Receipt, patient, invoice, reference…" />
            <SelectParam name="kind" options={[["RECEIPT", "Receipts"], ["ADVANCE", "Advances only"], ["REFUND", "Refunds"]]} placeholder="All types" />
            <SelectParam name="method" options={Object.entries(PAYMENT_METHOD_LABEL)} placeholder="Any method" />
            {scope.isAll && scope.branches.length > 1 && <SelectParam name="branch" options={scope.branches.map((b) => [b.id, b.name] as const)} placeholder="All branches" />}
            <DateParam name="from" label="From" />
            <DateParam name="to" label="To" />
          </FilterBar>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<Wallet className="h-5 w-5" />} title="No payments match" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Receipt</TH>
                <TH>Patient</TH>
                <TH className="hidden md:table-cell">For</TH>
                <TH className="hidden sm:table-cell">Method</TH>
                <TH className="hidden lg:table-cell">Received by</TH>
                <TH className="text-right">Amount</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <Link href={`/payments/${p.id}/print`} target="_blank" className="font-medium hover:text-accent">
                      {p.receiptNo}
                    </Link>
                    <p className="text-xs text-muted">
                      {fmtDate(p.paidAt)} · {fmtTime(p.paidAt)}
                      {scope.isAll && ` · ${p.branch.code}`}
                    </p>
                  </TD>
                  <TD>
                    <Link href={`/patients/${p.patient.id}?tab=billing`} className="hover:text-accent">
                      {p.patient.fullName}
                    </Link>
                    <p className="text-xs text-muted">{p.patient.code}</p>
                  </TD>
                  <TD className="hidden md:table-cell">
                    {p.invoice ? (
                      <Link href={`/billing/${p.invoice.id}`} className="text-ink-2 hover:text-accent">
                        {p.invoice.number}
                      </Link>
                    ) : (
                      <Badge tone="info">{p.kind === "REFUND" ? "Advance refund" : "Advance"}</Badge>
                    )}
                  </TD>
                  <TD className="hidden sm:table-cell">
                    {p.kind === "REFUND" ? <Badge tone="danger">Refund · {PAYMENT_METHOD_LABEL[p.method]}</Badge> : <span className="text-ink-2">{PAYMENT_METHOD_LABEL[p.method]}</span>}
                    {p.reference && <p className="max-w-40 truncate text-xs text-muted">{p.reference}</p>}
                  </TD>
                  <TD className="hidden text-ink-2 lg:table-cell">{(p.receivedById && U.get(p.receivedById)) ?? "—"}</TD>
                  <TD className={`tabular text-right font-medium ${p.kind === "REFUND" ? "text-danger" : ""}`} title={fmtDateTime(p.paidAt)}>
                    {p.kind === "REFUND" ? "−" : ""}
                    {money(p.amount)}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={count} hrefFor={(n) => withParams("/payments", sp, { page: n, created: null })} />
      </Card>
    </>
  );
}
