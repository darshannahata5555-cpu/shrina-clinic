import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, can } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { getSetting } from "@/lib/settings";
import { amountInWords, type PayrollLine } from "@/lib/payroll";
import { fmtDate, fmtMonth, fmtNum, humanize, minutesToHours, money, toNum } from "@/lib/format";
import { StatusBadge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page";
import { PrintButton } from "./print-button";

export const metadata = { title: "Salary slip" };

type Breakdown = { earnings?: PayrollLine[]; deductions?: PayrollLine[]; notes?: string[]; counts?: Record<string, number>; basisDays?: number };

export default async function SalarySlipPage({ params }: PageProps<"/payroll/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const scope = await getBranchScope();
  const p = await db.payroll.findUnique({ where: { id }, include: { staff: { include: { branch: true } } } });
  if (!p) notFound();
  // Payroll staff see slips in their branches; employees may see their own slip.
  const own = user.staff?.id === p.staffId;
  const allowed = own || (can(user, "payroll.view") && scope.branches.some((b) => b.id === p.staff.branchId));
  if (!allowed) notFound();

  const clinic = await getSetting("clinic");
  const b = (p.breakdown ?? {}) as Breakdown;
  const earnings = b.earnings ?? [{ label: "Salary", detail: "", amount: toNum(p.baseSalary) }];
  const deductions = b.deductions ?? [];
  const totalEarn = earnings.reduce((s, l) => s + l.amount, 0);
  const totalDed = deductions.reduce((s, l) => s + l.amount, 0);
  const monthLabel = fmtMonth(new Date(`${p.month}-15T00:00:00Z`));
  const s = p.staff;
  const maskAcct = s.bankAccount ? `XXXX${s.bankAccount.slice(-4)}` : "—";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print">
        <PageHeader
          title={`Salary slip · ${monthLabel}`}
          back={{ href: can(user, "payroll.view") ? `/payroll?month=${p.month}` : "/attendance/me", label: "Payroll" }}
          meta={<StatusBadge kind="payroll" status={p.status} />}
          actions={<PrintButton />}
        />
      </div>
      <article className="print-plain rounded-xl border border-border bg-surface p-6 text-[13px] shadow-card sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div>
            <p className="text-lg font-semibold tracking-[0.2em]">{clinic.clinicName}</p>
            <p className="text-muted">{clinic.legalName}</p>
            <p className="mt-1 max-w-xs text-xs text-muted">{s.branch.address ?? clinic.address}</p>
          </div>
          <div className="text-right">
            <p className="text-base font-semibold">Salary slip</p>
            <p className="text-muted">{monthLabel}</p>
            {p.status === "DRAFT" && <p className="mt-1 text-xs font-medium text-warning">DRAFT — not final</p>}
          </div>
        </header>

        <section className="grid grid-cols-2 gap-x-6 gap-y-2 border-b border-border py-5 sm:grid-cols-3">
          {[
            ["Employee", s.fullName],
            ["Employee ID", s.code],
            ["Designation", s.designation],
            ["Department", s.department],
            ["Branch", s.branch.name],
            ["Date of joining", fmtDate(s.joiningDate)],
            ["Bank", s.bankName ?? "—"],
            ["Account", maskAcct],
            ["IFSC", s.ifsc ?? "—"],
          ].map(([k, v]) => (
            <div key={k}>
              <p className="text-[11px] text-muted">{k}</p>
              <p className="font-medium">{v}</p>
            </div>
          ))}
        </section>

        <section className="grid grid-cols-3 gap-2 border-b border-border py-4 text-center sm:grid-cols-6">
          {[
            ["Days in month", p.calendarDays],
            ["Working days", p.workingDays],
            ["Present", fmtNum(p.presentDays)],
            ["Paid leave", fmtNum(p.paidLeaveDays)],
            ["Unpaid / absent", fmtNum(toNum(p.unpaidLeaveDays) + toNum(p.absentDays))],
            ["Late · OT", `${p.lateCount} · ${p.overtimeMinutes ? minutesToHours(p.overtimeMinutes) : "0h"}`],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-lg bg-surface-2 px-1 py-2">
              <p className="tabular font-semibold">{v}</p>
              <p className="text-[10.5px] text-muted">{k}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 py-5 sm:grid-cols-2">
          {[
            ["Earnings", earnings, totalEarn, "Total earnings"],
            ["Deductions", deductions, totalDed, "Total deductions"],
          ].map(([title, lines, total, label]) => (
            <div key={title as string}>
              <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">{title as string}</p>
              <table className="w-full">
                <tbody>
                  {(lines as PayrollLine[]).length === 0 && (
                    <tr>
                      <td className="py-1.5 text-muted">None</td>
                    </tr>
                  )}
                  {(lines as PayrollLine[]).map((l, i) => (
                    <tr key={i} className="border-b border-border/60 align-top">
                      <td className="py-1.5 pr-2">
                        {l.label}
                        {l.detail && <p className="text-[11px] text-muted">{l.detail}</p>}
                      </td>
                      <td className="tabular py-1.5 text-right whitespace-nowrap">{money(l.amount)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="pt-2 font-semibold">{label as string}</td>
                    <td className="tabular pt-2 text-right font-semibold">{money(total as number)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        </section>

        <section className="rounded-xl bg-accent-soft px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold text-accent">Net pay</p>
            <p className="tabular text-2xl font-semibold text-ink">{money(p.netPay)}</p>
          </div>
          <p className="mt-1 text-xs text-ink-2">{amountInWords(toNum(p.netPay))}</p>
        </section>

        {(b.notes?.length ?? 0) > 0 && (
          <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-muted">
            {b.notes!.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}

        <footer className="mt-6 flex flex-wrap justify-between gap-4 border-t border-border pt-4 text-xs text-muted">
          <p>
            {p.status === "PAID"
              ? `Paid on ${fmtDate(p.paidAt)} by ${humanize(p.paymentMethod ?? "")}${p.paymentRef ? ` · Ref ${p.paymentRef}` : ""}`
              : `Status: ${humanize(p.status)}`}
          </p>
          <p>Computer-generated salary slip — no signature required.</p>
        </footer>
      </article>
    </div>
  );
}
