import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { FileMinus } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { addDaysKey, fmtDate, fromIst, money } from "@/lib/format";
import { PAYMENT_METHOD_LABEL } from "@/lib/status";
import { PageHeader, Pagination, withParams } from "@/components/ui/page";
import { Card, EmptyState, StatCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { DateParam, FilterBar, SearchParamInput, SelectParam } from "@/components/ui/filters";
import { one } from "../_lib/filters";

export const metadata = { title: "Credit notes" };
const PAGE = 25;

export default async function CreditNotesPage({ searchParams }: PageProps<"/billing/credit-notes">) {
  await requirePermission("billing.view");
  const scope = await getBranchScope();
  const sp = await searchParams;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const q = one(sp.q).trim();
  const type = one(sp.type);
  const from = one(sp.from);
  const to = one(sp.to);
  const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

  const where: Prisma.CreditNoteWhereInput = { branchId: { in: scope.ids } };
  if (type === "REFUND") where.refundMethod = { not: null };
  if (type === "REDUCE") where.refundMethod = null;
  if (ok(from) || ok(to)) where.createdAt = { ...(ok(from) ? { gte: fromIst(from) } : {}), ...(ok(to) ? { lt: fromIst(addDaysKey(to, 1)) } : {}) };
  if (q)
    where.OR = [
      { number: { contains: q, mode: "insensitive" } },
      { reason: { contains: q, mode: "insensitive" } },
      { invoice: { number: { contains: q, mode: "insensitive" } } },
      { patient: { fullName: { contains: q, mode: "insensitive" } } },
    ];

  const [rows, count, agg] = await Promise.all([
    db.creditNote.findMany({
      where,
      include: { invoice: { select: { id: true, number: true } }, patient: { select: { id: true, fullName: true, code: true } }, branch: { select: { code: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
    }),
    db.creditNote.count({ where }),
    db.creditNote.aggregate({ where, _sum: { amount: true } }),
  ]);

  return (
    <>
      <PageHeader title="Credit notes" description="Refunds and amounts written off against invoices." back={{ href: "/billing", label: "Billing & Invoices" }} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Credit notes" value={count} />
        <StatCard label="Total credited" value={money(agg._sum.amount, { decimals: false })} tone="warning" />
      </div>
      <Card>
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <FilterBar>
            <SearchParamInput placeholder="CN no., invoice, patient, reason…" />
            <SelectParam name="type" options={[["REFUND", "Money refunded"], ["REDUCE", "Reduced amount due"]]} placeholder="Any type" />
            <DateParam name="from" label="From" />
            <DateParam name="to" label="To" />
          </FilterBar>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<FileMinus className="h-5 w-5" />} title="No credit notes" description="Credit notes are issued from an invoice (Credit note / refund)." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Credit note</TH>
                <TH>Invoice</TH>
                <TH className="hidden md:table-cell">Patient</TH>
                <TH className="hidden lg:table-cell">Reason</TH>
                <TH>Type</TH>
                <TH className="text-right">Amount</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <p className="font-medium">{c.number}</p>
                    <p className="text-xs text-muted">
                      {fmtDate(c.createdAt)}
                      {scope.isAll && ` · ${c.branch.code}`}
                    </p>
                  </TD>
                  <TD>
                    <Link href={`/billing/${c.invoice.id}`} className="hover:text-accent">
                      {c.invoice.number}
                    </Link>
                  </TD>
                  <TD className="hidden md:table-cell">
                    <Link href={`/patients/${c.patient.id}?tab=billing`} className="hover:text-accent">
                      {c.patient.fullName}
                    </Link>
                  </TD>
                  <TD className="hidden max-w-xs truncate text-ink-2 lg:table-cell">{c.reason}</TD>
                  <TD>{c.refundMethod ? <Badge tone="danger">Refund · {PAYMENT_METHOD_LABEL[c.refundMethod]}</Badge> : <Badge tone="neutral">Reduced due</Badge>}</TD>
                  <TD className="tabular text-right font-medium">{money(c.amount)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={count} hrefFor={(p) => withParams("/billing/credit-notes", sp, { page: p })} />
      </Card>
    </>
  );
}
