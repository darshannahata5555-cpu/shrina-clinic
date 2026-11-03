import "server-only";
import type { ApprovalStatus, ExpenseCategory, Prisma } from "@prisma/client";
import type { CurrentUser } from "@/lib/auth";
import { addDaysKey, fromIst } from "@/lib/format";
import { EXPENSE_CATEGORY_LABEL } from "@/lib/status";

type SP = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const has = (u: Pick<CurrentUser, "permissions">, p: string) => u.permissions.has(p);

/** Expenses: approvers & viewers see every expense in scope; submit-only staff see their own. */
export const seesAllExpenses = (u: CurrentUser) => has(u, "expenses.view") || has(u, "expenses.approve");
export const canSubmitExpense = (u: CurrentUser) => has(u, "expenses.create") || has(u, "expenses.approve");
export const canApproveExpense = (u: CurrentUser) => has(u, "expenses.approve");
export const hasExpenseTab = (u: CurrentUser) => seesAllExpenses(u) || canSubmitExpense(u);

/** Activities: viewers see all in scope; record-only staff see their own. */
export const seesAllActivities = (u: CurrentUser) => has(u, "activities.view");
export const canRecordActivity = (u: CurrentUser) => has(u, "activities.create");
export const hasActivityTab = (u: CurrentUser) => seesAllActivities(u) || canRecordActivity(u);
/**
 * Marking an activity REVIEWED is a supervisory sign-off: it needs activities.view plus a
 * supervisory permission (expenses.approve or leaves.approve) — i.e. owner, branch manager, HR.
 */
export const canReviewActivity = (u: CurrentUser) => seesAllActivities(u) && (has(u, "expenses.approve") || has(u, "leaves.approve"));

export function expenseWhere(sp: SP, user: CurrentUser, branchIds: string[]): Prisma.ExpenseWhereInput {
  // Ignore values that aren't valid for expenses (the activities tab shares ?status=).
  const status = ["PENDING", "APPROVED", "REJECTED"].includes(str(sp.status)) ? str(sp.status) : "";
  const category = Object.hasOwn(EXPENSE_CATEGORY_LABEL, str(sp.category)) ? str(sp.category) : "";
  const from = str(sp.from);
  const to = str(sp.to);
  const q = str(sp.q).trim();
  const mine = str(sp.mine) === "1";
  return {
    deletedAt: null,
    branchId: { in: branchIds },
    ...(!seesAllExpenses(user) || mine ? { addedById: user.id } : {}),
    ...(status ? { status: status as ApprovalStatus } : {}),
    ...(category ? { category: category as ExpenseCategory } : {}),
    ...(from || to ? { date: { ...(from ? { gte: fromIst(from) } : {}), ...(to ? { lt: fromIst(addDaysKey(to, 1)) } : {}) } } : {}),
    ...(q
      ? {
          OR: [
            { paidTo: { contains: q, mode: "insensitive" } },
            { code: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}
