import Link from "next/link";
import { Check, Download, Hourglass, Paperclip, Pencil, PiggyBank, Plus, Receipt, Trash2, X } from "lucide-react";
import { db } from "@/lib/db";
import { can, type CurrentUser } from "@/lib/auth";
import type { BranchScope } from "@/lib/branch";
import { fmtDate, istDateKey, money, moneyShort, toIstDateInput, toNum } from "@/lib/format";
import { EXPENSE_CATEGORY_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/status";
import { fileUrl } from "@/lib/storage";
import { Pagination, withParams } from "@/components/ui/page";
import { Card, CardBody, CardHeader, EmptyState, StatCard } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionButton } from "@/components/ui/form";
import { DateParam, FilterBar, SearchParamInput, SelectParam } from "@/components/ui/filters";
import { Table, TableEmpty, TD, TH, THead, TR } from "@/components/ui/table";
import { canApproveExpense, canSubmitExpense, expenseWhere, seesAllExpenses } from "./_lib/access";
import { ExpenseForm, RejectExpenseForm } from "./forms";
import { approveExpenseAction, deleteExpenseAction } from "./actions";

const PAGE_SIZE = 25;
type SP = Record<string, string | string[] | undefined>;

export async function ExpensesTab({ user, scope, sp }: { user: CurrentUser; scope: BranchScope; sp: SP }) {
  const page = Math.max(1, Number(sp.page) || 1);
  const where = expenseWhere(sp, user, scope.ids);
  const approver = canApproveExpense(user);
  const seesAll = seesAllExpenses(user);
  const canSubmit = canSubmitExpense(user);

  const [total, expenses, byStatus, byCategory, pendingAll] = await Promise.all([
    db.expense.count({ where }),
    db.expense.findMany({
      where,
      include: { branch: { select: { code: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.expense.groupBy({ by: ["status"], where, _sum: { amount: true }, _count: true }),
    db.expense.groupBy({ by: ["category"], where: { ...where, status: { not: "REJECTED" } }, _sum: { amount: true }, _count: true }),
    approver
      ? db.expense.aggregate({ where: { deletedAt: null, branchId: { in: scope.ids }, status: "PENDING" }, _sum: { amount: true }, _count: true })
      : Promise.resolve(null),
  ]);
  const people = await db.user.findMany({
    where: { id: { in: [...new Set(expenses.flatMap((e) => [e.addedById, e.approvedById]).filter(Boolean) as string[])] } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const st = (s: string) => byStatus.find((x) => x.status === s);
  const spend = toNum(st("APPROVED")?._sum.amount) + toNum(st("PENDING")?._sum.amount);
  const cats = byCategory.map((c) => ({ key: c.category, amount: toNum(c._sum.amount), count: c._count })).sort((a, b) => b.amount - a.amount);
  const catMax = Math.max(1, ...cats.map((c) => c.amount));
  const branchOpts = scope.branches.map((b) => [b.id, b.name] as const);
  const today = istDateKey();

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{seesAll ? `Clinic expenses for ${scope.current?.name ?? "all branches"}.` : "Expenses you have submitted."}</p>
        <div className="flex flex-wrap gap-2">
          {can(user, "reports.export") && seesAll && (
            <a href={withParams("/api/expenses/export", sp, { page: null, tab: null })} className={buttonClass("outline")}>
              <Download className="h-4 w-4" /> Excel
            </a>
          )}
          {canSubmit && (
            <Dialog title="New expense" trigger={<Button><Plus className="h-4 w-4" /> New expense</Button>}>
              <ExpenseForm branches={branchOpts} defaultBranchId={scope.defaultBranchId} today={today} autoApprove={approver} />
            </Dialog>
          )}
        </div>
      </div>

      {pendingAll && pendingAll._count > 0 && sp.status !== "PENDING" && (
        <Link
          href="/expenses?status=PENDING"
          className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning hover:brightness-[0.98]"
        >
          <span className="flex items-center gap-2 font-medium">
            <Hourglass className="h-4 w-4" /> {pendingAll._count} expense{pendingAll._count > 1 ? "s" : ""} awaiting your approval · {money(pendingAll._sum.amount, { decimals: false })}
          </span>
          <span>Review →</span>
        </Link>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total spend (filtered)" value={moneyShort(spend)} hint="Approved + pending" icon={<PiggyBank className="h-[18px] w-[18px]" />} tone="accent" />
        <StatCard label="Approved" value={moneyShort(st("APPROVED")?._sum.amount)} hint={`${st("APPROVED")?._count ?? 0} expenses`} icon={<Check className="h-[18px] w-[18px]" />} tone="success" href={withParams("/expenses", sp, { status: "APPROVED", page: null })} />
        <StatCard label="Pending approval" value={moneyShort(st("PENDING")?._sum.amount)} hint={`${st("PENDING")?._count ?? 0} expenses`} icon={<Hourglass className="h-[18px] w-[18px]" />} tone="warning" href={withParams("/expenses", sp, { status: "PENDING", page: null })} />
        <StatCard label="Rejected" value={moneyShort(st("REJECTED")?._sum.amount)} hint={`${st("REJECTED")?._count ?? 0} expenses`} icon={<X className="h-[18px] w-[18px]" />} tone="danger" href={withParams("/expenses", sp, { status: "REJECTED", page: null })} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <Card className="min-w-0">
          <div className="border-b border-border px-4 py-3 sm:px-5">
            <FilterBar>
              <SearchParamInput placeholder="Paid to, code or note" />
              <SelectParam name="status" placeholder="All statuses" options={[["PENDING", "Pending"], ["APPROVED", "Approved"], ["REJECTED", "Rejected"]]} />
              <SelectParam name="category" placeholder="All categories" options={Object.entries(EXPENSE_CATEGORY_LABEL)} />
              <DateParam name="from" label="From" />
              <DateParam name="to" label="To" />
              {seesAll && canSubmit && <SelectParam name="mine" placeholder="Everyone" options={[["1", "Only mine"]]} />}
            </FilterBar>
          </div>
          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Paid to</TH>
                <TH className="hidden md:table-cell">Category</TH>
                <TH className="text-right">Amount</TH>
                <TH>Status</TH>
                <TH className="hidden lg:table-cell">Submitted by</TH>
                <TH className="text-right">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <tbody>
              {expenses.length === 0 ? (
                <TableEmpty colSpan={7}>
                  <EmptyState className="py-4" icon={<Receipt className="h-5 w-5" />} title="No expenses found" description={canSubmit ? "Use “New expense” to record one." : undefined} />
                </TableEmpty>
              ) : (
                expenses.map((e) => {
                  const own = e.addedById === user.id;
                  const canEdit = approver || (own && (e.status === "PENDING" || e.status === "REJECTED") && canSubmit);
                  const canDelete = approver || (own && e.status !== "APPROVED" && canSubmit);
                  const receipt = fileUrl(e.receiptPath);
                  return (
                    <TR key={e.id}>
                      <TD className="whitespace-nowrap text-ink-2">
                        {fmtDate(e.date)}
                        <p className="text-[11px] text-muted">
                          {e.code}
                          {scope.isAll ? ` · ${e.branch.code}` : ""}
                        </p>
                      </TD>
                      <TD className="max-w-72">
                        <p className="font-medium">{e.paidTo}</p>
                        {e.description && <p className="truncate text-xs text-muted" title={e.description}>{e.description}</p>}
                        <p className="text-xs text-muted md:hidden">{EXPENSE_CATEGORY_LABEL[e.category]}</p>
                        {e.status === "REJECTED" && e.rejectionReason && <p className="text-xs text-danger">Rejected: {e.rejectionReason}</p>}
                      </TD>
                      <TD className="hidden text-ink-2 md:table-cell">{EXPENSE_CATEGORY_LABEL[e.category]}</TD>
                      <TD className="tabular text-right whitespace-nowrap">
                        <span className="font-medium">{money(e.amount)}</span>
                        <p className="text-[11px] text-muted">{PAYMENT_METHOD_LABEL[e.method]}</p>
                      </TD>
                      <TD>
                        <StatusBadge kind="approval" status={e.status} />
                        {e.approvedById && e.status !== "PENDING" && (
                          <p className="mt-0.5 text-[11px] text-muted">by {nameOf.get(e.approvedById) ?? "—"}</p>
                        )}
                      </TD>
                      <TD className="hidden text-ink-2 lg:table-cell">{(e.addedById && nameOf.get(e.addedById)) || "—"}</TD>
                      <TD className="text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {receipt && (
                            <a href={receipt} target="_blank" rel="noreferrer" title="View receipt" className="rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-ink">
                              <Paperclip className="h-4 w-4" />
                            </a>
                          )}
                          {approver && e.status === "PENDING" && (
                            <>
                              <ActionButton action={approveExpenseAction} fields={{ id: e.id }} variant="soft" title="Approve">
                                <Check className="h-3.5 w-3.5" /> Approve
                              </ActionButton>
                              <Dialog size="sm" title={`Reject ${e.code}`} description={`${money(e.amount)} to ${e.paidTo}`} trigger={<Button variant="ghost" size="sm">Reject</Button>}>
                                <RejectExpenseForm id={e.id} />
                              </Dialog>
                            </>
                          )}
                          {canEdit && (
                            <Dialog
                              title={`Edit ${e.code}`}
                              trigger={
                                <Button variant="ghost" size="icon" title="Edit" aria-label="Edit">
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              }
                            >
                              <ExpenseForm
                                branches={branchOpts}
                                today={today}
                                autoApprove={approver}
                                values={{
                                  id: e.id,
                                  branchId: e.branchId,
                                  date: toIstDateInput(e.date),
                                  category: e.category,
                                  amount: toNum(e.amount),
                                  paidTo: e.paidTo,
                                  method: e.method,
                                  description: e.description,
                                  receiptUrl: receipt,
                                  status: e.status,
                                  rejectionReason: e.rejectionReason,
                                }}
                              />
                            </Dialog>
                          )}
                          {canDelete && (
                            <ActionButton action={deleteExpenseAction} fields={{ id: e.id }} variant="ghost" size="icon" title="Delete" confirm={`Delete expense ${e.code} (${money(e.amount)} to ${e.paidTo})?`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </ActionButton>
                          )}
                        </div>
                      </TD>
                    </TR>
                  );
                })
              )}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(p) => withParams("/expenses", sp, { page: p })} />
        </Card>

        <Card className="h-fit">
          <CardHeader title="By category" description="Matching the filters (excl. rejected)" />
          <CardBody className="space-y-3">
            {cats.length === 0 ? (
              <p className="text-sm text-muted">Nothing to show.</p>
            ) : (
              cats.map((c) => (
                <Link key={c.key} href={withParams("/expenses", sp, { category: c.key, page: null })} className="block group">
                  <div className="flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="truncate text-ink-2 group-hover:text-ink">{EXPENSE_CATEGORY_LABEL[c.key]}</span>
                    <span className="tabular shrink-0 font-medium">{money(c.amount, { decimals: false })}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-surface-3">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (c.amount / catMax) * 100)}%` }} />
                  </div>
                </Link>
              ))
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
