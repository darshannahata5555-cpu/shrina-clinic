import Link from "next/link";
import { Hourglass, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { fmtDate, money, moneyShort, r2, toNum } from "@/lib/format";
import { PageHeader, LinkTabs, withParams } from "@/components/ui/page";
import { Card, EmptyState, StatCard } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { FilterBar, SearchParamInput, SelectParam } from "@/components/ui/filters";
import { one } from "../../billing/_lib/filters";

export const metadata = { title: "Outstanding balances" };

const BUCKETS = [
  ["0-30", "0–30 days"],
  ["31-60", "31–60 days"],
  ["61-90", "61–90 days"],
  ["90+", "Over 90 days"],
] as const;
type Bucket = (typeof BUCKETS)[number][0];
const bucketOf = (days: number): Bucket => (days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+");

export default async function OutstandingPage({ searchParams }: PageProps<"/payments/outstanding">) {
  const user = await requirePermission("billing.view");
  const scope = await getBranchScope();
  const sp = await searchParams;
  const tab = one(sp.tab) === "advances" ? "advances" : "dues";
  const q = one(sp.q).trim().toLowerCase();
  const age = one(sp.age) as Bucket | "";
  const now = Date.now();

  const invoices = await db.invoice.findMany({
    where: { deletedAt: null, branchId: { in: scope.ids }, status: { in: ["UNPAID", "PARTIAL"] }, balance: { gt: 0 } },
    select: { id: true, number: true, date: true, balance: true, patient: { select: { id: true, fullName: true, code: true, mobile: true } } },
    orderBy: { date: "asc" },
  });

  type Row = { id: string; name: string; code: string; mobile: string; total: number; count: number; oldest: Date; oldestInvoice: { id: string; number: string }; buckets: Record<Bucket, number> };
  const byPatient = new Map<string, Row>();
  const bucketTotals: Record<Bucket, number> = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const inv of invoices) {
    const bal = toNum(inv.balance);
    const b = bucketOf(Math.floor((now - inv.date.getTime()) / 86400000));
    bucketTotals[b] += bal;
    let r = byPatient.get(inv.patient.id);
    if (!r) {
      r = { id: inv.patient.id, name: inv.patient.fullName, code: inv.patient.code, mobile: inv.patient.mobile, total: 0, count: 0, oldest: inv.date, oldestInvoice: { id: inv.id, number: inv.number }, buckets: { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 } };
      byPatient.set(inv.patient.id, r);
    }
    r.total += bal;
    r.count++;
    r.buckets[b] += bal;
  }
  let dues = [...byPatient.values()];
  if (q) dues = dues.filter((r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || r.mobile.includes(q));
  if (age) dues = dues.filter((r) => r.buckets[age] > 0);
  dues.sort((a, b) => b.total - a.total);
  const totalDue = r2(Object.values(bucketTotals).reduce((a, b) => a + b, 0));

  // Advance (wallet) balances — patient level, computed from all of the patient's payments.
  const advPatients = await db.payment.findMany({
    where: { branchId: { in: scope.ids }, OR: [{ invoiceId: null }, { method: "ADVANCE" }] },
    select: { patientId: true },
    distinct: ["patientId"],
  });
  const advRows = advPatients.length
    ? await db.payment.findMany({
        where: { patientId: { in: advPatients.map((p) => p.patientId) }, OR: [{ invoiceId: null }, { method: "ADVANCE" }] },
        select: { patientId: true, amount: true, kind: true, method: true, invoiceId: true, paidAt: true, patient: { select: { fullName: true, code: true, mobile: true } } },
      })
    : [];
  const adv = new Map<string, { id: string; name: string; code: string; mobile: string; balance: number; last: Date }>();
  for (const p of advRows) {
    const a = toNum(p.amount);
    const delta = p.kind === "RECEIPT" && !p.invoiceId && p.method !== "ADVANCE" ? a : p.kind === "RECEIPT" && p.method === "ADVANCE" ? -a : p.kind === "REFUND" && !p.invoiceId ? -a : 0;
    const row = adv.get(p.patientId) ?? { id: p.patientId, name: p.patient.fullName, code: p.patient.code, mobile: p.patient.mobile, balance: 0, last: p.paidAt };
    row.balance = r2(row.balance + delta);
    if (p.paidAt > row.last) row.last = p.paidAt;
    adv.set(p.patientId, row);
  }
  let advances = [...adv.values()].filter((r) => r.balance > 0.009);
  if (q) advances = advances.filter((r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || r.mobile.includes(q));
  advances.sort((a, b) => b.balance - a.balance);
  const totalAdvance = r2(advances.reduce((s, r) => s + r.balance, 0));

  return (
    <>
      <PageHeader
        title="Outstanding balances"
        description="Patient-wise dues with ageing, and advance money held for patients."
        back={{ href: "/payments", label: "Payments" }}
        actions={can(user, "billing.create") && <LinkButton href="/payments/new">Record payment</LinkButton>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total outstanding" value={moneyShort(totalDue)} hint={`${byPatient.size} patients · ${invoices.length} invoices`} icon={<Hourglass className="h-[18px] w-[18px]" />} tone="warning" />
        {BUCKETS.map(([k, l]) => (
          <StatCard key={k} label={l} value={moneyShort(bucketTotals[k])} tone={k === "90+" ? "danger" : "neutral"} href={withParams("/payments/outstanding", sp, { age: k, tab: null })} />
        ))}
        <StatCard label="Advances held" value={moneyShort(totalAdvance)} hint={`${advances.length} patients`} icon={<Wallet className="h-[18px] w-[18px]" />} tone="success" href={withParams("/payments/outstanding", sp, { tab: "advances", age: null })} />
      </div>

      <LinkTabs
        active={tab}
        tabs={[
          { key: "dues", label: "Dues", href: withParams("/payments/outstanding", sp, { tab: null }), count: byPatient.size },
          { key: "advances", label: "Advance balances", href: withParams("/payments/outstanding", sp, { tab: "advances", age: null }), count: advances.length },
        ]}
      />

      <Card>
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <FilterBar>
            <SearchParamInput placeholder="Patient name, ID or mobile…" />
            {tab === "dues" && <SelectParam name="age" options={BUCKETS} placeholder="Any age" />}
          </FilterBar>
        </div>
        {tab === "dues" ? (
          dues.length === 0 ? (
            <EmptyState icon={<Hourglass className="h-5 w-5" />} title="No outstanding dues" description="Every invoice in this view is fully paid." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Patient</TH>
                  <TH className="hidden md:table-cell">Oldest unpaid</TH>
                  {BUCKETS.map(([k, l]) => (
                    <TH key={k} className="hidden text-right lg:table-cell">
                      {l}
                    </TH>
                  ))}
                  <TH className="text-right">Total due</TH>
                </tr>
              </THead>
              <tbody>
                {dues.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <Link href={`/patients/${r.id}?tab=billing`} className="font-medium hover:text-accent">
                        {r.name}
                      </Link>
                      <p className="text-xs text-muted">
                        {r.code} · {r.mobile} · {r.count} invoice{r.count > 1 ? "s" : ""}
                      </p>
                    </TD>
                    <TD className="hidden md:table-cell">
                      <Link href={`/billing/${r.oldestInvoice.id}`} className="text-ink-2 hover:text-accent">
                        {r.oldestInvoice.number}
                      </Link>
                      <p className="text-xs text-muted">{fmtDate(r.oldest)}</p>
                    </TD>
                    {BUCKETS.map(([k]) => (
                      <TD key={k} className={`tabular hidden text-right lg:table-cell ${r.buckets[k] ? (k === "90+" ? "text-danger" : "text-ink-2") : "text-muted"}`}>
                        {r.buckets[k] ? money(r.buckets[k], { decimals: false }) : "—"}
                      </TD>
                    ))}
                    <TD className="tabular text-right font-semibold">
                      {money(r.total)}
                      {can(user, "billing.create") && (
                        <Link href={`/payments/new?patientId=${r.id}&invoiceId=${r.oldestInvoice.id}`} className="block text-xs font-normal text-accent hover:underline">
                          Collect →
                        </Link>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )
        ) : advances.length === 0 ? (
          <EmptyState icon={<Wallet className="h-5 w-5" />} title="No advance balances" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Patient</TH>
                <TH className="hidden sm:table-cell">Last activity</TH>
                <TH className="text-right">Advance balance</TH>
              </tr>
            </THead>
            <tbody>
              {advances.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Link href={`/patients/${r.id}?tab=billing`} className="font-medium hover:text-accent">
                      {r.name}
                    </Link>
                    <p className="text-xs text-muted">
                      {r.code} · {r.mobile}
                    </p>
                  </TD>
                  <TD className="hidden text-ink-2 sm:table-cell">{fmtDate(r.last)}</TD>
                  <TD className="tabular text-right font-semibold text-success">{money(r.balance)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
