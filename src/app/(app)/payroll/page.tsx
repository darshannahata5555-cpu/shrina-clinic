import Link from "next/link";
import { Banknote, Calculator, Download, Plus, Settings2 } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { getSetting } from "@/lib/settings";
import { previousMonth } from "@/lib/payroll";
import { fmtDate, fmtMonth, fmtNum, humanize, istDateKey, minutesToHours, money, moneyShort, toNum } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, EmptyState, StatCard } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionButton } from "@/components/ui/form";
import { Table, THead, TH, TR, TD, TableEmpty } from "@/components/ui/table";
import { MonthNav } from "../attendance/_components/month-calendar";
import { AdjustmentForm, MarkPaidForm } from "./payroll-forms";
import { deleteAdjustmentAction, finalizePayrollAction, recalcOneAction, reopenPayrollAction, runPayrollAction } from "./actions";

export const metadata = { title: "Payroll" };

const BASIS: Record<string, string> = {
  CALENDAR: "salary ÷ days in month",
  WORKING: "salary ÷ working days",
  FIXED_30: "salary ÷ 30",
  FIXED_26: "salary ÷ 26",
};

export default async function PayrollPage({ searchParams }: PageProps<"/payroll">) {
  const user = await requirePermission("payroll.view");
  const scope = await getBranchScope();
  const sp = await searchParams;
  const current = istDateKey().slice(0, 7);
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) && sp.month <= current ? sp.month : previousMonth(current);
  const manage = can(user, "payroll.manage");
  const today = istDateKey();

  const [rows, adjustments, staff, rules] = await Promise.all([
    db.payroll.findMany({
      where: { month, staff: { branchId: { in: scope.ids } } },
      include: { staff: { select: { id: true, fullName: true, code: true, designation: true, salaryType: true, branch: { select: { code: true } } } } },
      orderBy: { staff: { fullName: "asc" } },
    }),
    db.payrollAdjustment.findMany({
      where: { month, staff: { branchId: { in: scope.ids } } },
      include: { staff: { select: { fullName: true, code: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.staff.findMany({ where: { deletedAt: null, status: { in: ["ACTIVE", "ON_NOTICE"] }, branchId: { in: scope.ids } }, select: { id: true, fullName: true, code: true }, orderBy: { fullName: "asc" } }),
    getSetting("payroll"),
  ]);

  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  const totalNet = sum((r) => toNum(r.netPay));
  const deductionsOf = (r: (typeof rows)[number]) =>
    toNum(r.leaveDeduction) + toNum(r.halfDayDeduction) + toNum(r.absentDeduction) + toNum(r.lateDeduction) + toNum(r.advances) + toNum(r.otherDeductions);
  // Earnings = base salary + overtime + incentives/bonus (before any deduction), so Earnings − Deductions = Net pay.
  const totalGross = sum((r) => toNum(r.netPay) + deductionsOf(r));
  const paid = sum((r) => (r.status === "PAID" ? toNum(r.netPay) : 0));
  const drafts = rows.filter((r) => r.status === "DRAFT").length;
  const missing = staff.filter((s) => !rows.some((r) => r.staffId === s.id)).length;
  const monthLabel = fmtMonth(new Date(`${month}-15T00:00:00Z`));

  return (
    <>
      <PageHeader
        title="Payroll"
        description={`Salaries are calculated from attendance, approved leave and adjustments · ${BASIS[rules.salaryBasis]}`}
        actions={
          <>
            {(manage || can(user, "settings.manage")) && (
              <LinkButton href="/payroll/settings" variant="outline">
                <Settings2 className="h-4 w-4" /> Rules
              </LinkButton>
            )}
            {rows.length > 0 && (
              <a href={`/payroll/export?month=${month}`} className="inline-flex h-9.5 items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3.5 text-sm font-medium hover:bg-surface-2">
                <Download className="h-4 w-4" /> Excel
              </a>
            )}
            {manage && (
              <ActionButton action={runPayrollAction} fields={{ month }} variant="primary" size="md" successMessage="Payroll calculated">
                <Calculator className="h-4 w-4" /> {rows.length ? "Recalculate drafts" : "Run payroll"}
              </ActionButton>
            )}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <MonthNav month={month} hrefFor={(m) => `/payroll?month=${m}`} />
        {month === current && <Badge tone="warning">Month in progress — upcoming days are assumed paid until you recalculate after month end</Badge>}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={`Net payable · ${monthLabel}`} value={moneyShort(totalNet)} hint={`${rows.length} employee${rows.length === 1 ? "" : "s"}`} icon={<Banknote className="h-[18px] w-[18px]" />} tone="accent" />
        <StatCard label="Gross pay" value={moneyShort(totalGross)} hint="Before advances & deductions" />
        <StatCard label="Paid out" value={moneyShort(paid)} hint={`${rows.filter((r) => r.status === "PAID").length} paid · ${moneyShort(totalNet - paid)} pending`} tone="success" />
        <StatCard label="Drafts" value={drafts} hint={missing ? `${missing} active employee(s) not calculated yet` : "Finalize to lock"} tone={drafts ? "warning" : "neutral"} />
      </div>

      <Card className="mb-5">
        <CardHeader
          title={`Salary sheet — ${monthLabel}`}
          actions={
            manage &&
            drafts > 0 && (
              <ActionButton action={finalizePayrollAction} fields={{ month }} confirm={`Finalize all ${drafts} draft payroll records for ${monthLabel}? They can be reopened until paid.`}>
                Finalize all drafts
              </ActionButton>
            )
          }
        />
        {rows.length === 0 ? (
          <EmptyState
            icon={<Calculator className="h-5 w-5" />}
            title={`Payroll for ${monthLabel} hasn't been run`}
            description="Running payroll reads each employee's attendance, approved leave, late marks, overtime and adjustments for the month."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Employee</TH>
                <TH className="hidden md:table-cell text-right">Paid days</TH>
                <TH className="hidden lg:table-cell text-right">Absent / LOP</TH>
                <TH className="hidden lg:table-cell text-right">Late / OT</TH>
                <TH className="hidden sm:table-cell text-right" title="Base salary + overtime + incentives / bonus">Earnings</TH>
                <TH className="hidden xl:table-cell text-right">Deductions</TH>
                <TH className="text-right">Net pay</TH>
                <TH>Status</TH>
                <TH />
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => {
                const lop = toNum(r.absentDays) + toNum(r.unpaidLeaveDays) + r.halfDays * 0.5;
                const ded = toNum(r.leaveDeduction) + toNum(r.halfDayDeduction) + toNum(r.absentDeduction) + toNum(r.lateDeduction) + toNum(r.advances) + toNum(r.otherDeductions);
                return (
                  <TR key={r.id}>
                    <TD>
                      <Link href={`/payroll/${r.id}`} className="font-medium hover:text-accent">
                        {r.staff.fullName}
                      </Link>
                      <p className="text-xs text-muted">
                        {r.staff.code} · {r.staff.designation}
                        {scope.isAll && ` · ${r.staff.branch.code}`}
                      </p>
                    </TD>
                    <TD className="tabular hidden text-right md:table-cell">
                      {fmtNum(toNum(r.presentDays) + toNum(r.paidLeaveDays))}
                      <span className="text-muted"> / {r.workingDays}</span>
                    </TD>
                    <TD className="tabular hidden text-right lg:table-cell">{lop ? fmtNum(lop) : "—"}</TD>
                    <TD className="tabular hidden text-right text-ink-2 lg:table-cell">
                      {r.lateCount || "—"} / {r.overtimeMinutes ? minutesToHours(r.overtimeMinutes) : "—"}
                    </TD>
                    <TD className="tabular hidden text-right sm:table-cell">{money(toNum(r.netPay) + ded, { decimals: false })}</TD>
                    <TD className="tabular hidden text-right text-danger xl:table-cell">{ded ? `−${money(ded, { decimals: false })}` : "—"}</TD>
                    <TD className="tabular text-right font-semibold">{money(r.netPay, { decimals: false })}</TD>
                    <TD>
                      <StatusBadge kind="payroll" status={r.status} />
                      {r.paidAt && <p className="mt-0.5 text-[11px] text-muted">{fmtDate(r.paidAt)}</p>}
                    </TD>
                    <TD className="whitespace-nowrap text-right">
                      <LinkButton href={`/payroll/${r.id}`} variant="ghost" size="sm">
                        Slip
                      </LinkButton>
                      {manage && r.status === "DRAFT" && (
                        <>
                          <ActionButton action={recalcOneAction} fields={{ id: r.id }} variant="ghost">
                            Recalc
                          </ActionButton>
                          <ActionButton action={finalizePayrollAction} fields={{ id: r.id }} variant="ghost">
                            Finalize
                          </ActionButton>
                        </>
                      )}
                      {manage && r.status === "FINALIZED" && (
                        <>
                          <Dialog title={`Pay ${r.staff.fullName}`} description={monthLabel} size="sm" trigger={<Button size="sm">Mark paid</Button>}>
                            <MarkPaidForm id={r.id} today={today} amount={money(r.netPay)} />
                          </Dialog>
                          <ActionButton action={reopenPayrollAction} fields={{ id: r.id }} variant="ghost">
                            Reopen
                          </ActionButton>
                        </>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Advances, incentives & deductions"
          description={`Applied to ${monthLabel}'s payroll. Recalculated automatically for draft payroll.`}
          actions={
            manage && (
              <Dialog title="Add payroll adjustment" trigger={<Button variant="outline" size="sm"><Plus className="h-3.5 w-3.5" /> Add</Button>}>
                <AdjustmentForm month={month} staff={staff.map((s) => ({ id: s.id, label: `${s.fullName} (${s.code})` }))} />
              </Dialog>
            )
          }
        />
        <Table>
          <THead>
            <tr>
              <TH>Employee</TH>
              <TH>Type</TH>
              <TH className="hidden sm:table-cell">Note</TH>
              <TH className="text-right">Amount</TH>
              {manage && <TH />}
            </tr>
          </THead>
          <tbody>
            {adjustments.length === 0 && <TableEmpty colSpan={5}>No adjustments for {monthLabel}.</TableEmpty>}
            {adjustments.map((a) => (
              <TR key={a.id}>
                <TD>
                  {a.staff.fullName} <span className="text-xs text-muted">{a.staff.code}</span>
                </TD>
                <TD>
                  <Badge tone={a.type === "INCENTIVE" || a.type === "BONUS" ? "success" : "warning"}>{humanize(a.type)}</Badge>
                </TD>
                <TD className="hidden text-ink-2 sm:table-cell">{a.note ?? "—"}</TD>
                <TD className={`tabular text-right ${a.type === "INCENTIVE" || a.type === "BONUS" ? "" : "text-danger"}`}>
                  {a.type === "INCENTIVE" || a.type === "BONUS" ? "+" : "−"}
                  {money(a.amount)}
                </TD>
                {manage && (
                  <TD className="text-right">
                    <ActionButton action={deleteAdjustmentAction} fields={{ id: a.id }} variant="ghost" confirm="Remove this adjustment?">
                      Remove
                    </ActionButton>
                  </TD>
                )}
              </TR>
            ))}
          </tbody>
        </Table>
        <CardBody className="border-t border-border text-xs text-muted">
          Rules: late grace {rules.lateGraceMinutes} min · every {rules.latesPerHalfDay} lates = ½ day · half day under {rules.fullDayMinHours} h worked · overtime {rules.overtimeEnabled ? `after ${rules.overtimeMinMinutes} min at ${rules.overtimeRateMultiplier}×` : "off"} · weekly offs {rules.weeklyOffPaid ? "paid" : "unpaid"}.
        </CardBody>
      </Card>
    </>
  );
}
