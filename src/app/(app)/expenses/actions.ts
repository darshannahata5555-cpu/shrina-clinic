"use server";

import { z } from "zod";
import type { ActivityStatus, ActivityType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ActionError, assertPermission, getCurrentUser } from "@/lib/auth";
import { assertBranchAccess, resolveWriteBranch } from "@/lib/branch";
import { handle, parse, formObject, zf, type ActionState } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { nextExpenseCode } from "@/lib/sequence";
import { notifyUsers } from "@/lib/notify";
import { saveUpload } from "@/lib/storage";
import { fmtDate, istDayRange, money } from "@/lib/format";
import { EXPENSE_CATEGORY_LABEL } from "@/lib/status";
import { canApproveExpense, canReviewActivity, canSubmitExpense } from "./_lib/access";
import { ACTIVITY_TYPE_LABEL, DEFAULT_CHECKLISTS, isChecklist, parseChecklist, type ChecklistItem } from "./_lib/labels";

const CATEGORIES = ["RENT", "ELECTRICITY", "INTERNET", "SALARIES", "PRODUCT_PURCHASE", "EQUIPMENT_MAINTENANCE", "MARKETING", "HOUSEKEEPING", "OFFICE_SUPPLIES", "TRANSPORTATION", "OTHER"] as const;
const METHODS = ["CASH", "UPI", "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "ONLINE"] as const;

// ───────────────────────────── Expenses ─────────────────────────────

const ExpenseSchema = z.object({
  id: zf.optId(),
  branchId: zf.optId(),
  date: zf.date("Expense date"),
  category: z.enum(CATEGORIES, { error: "Choose a category" }),
  amount: zf.num("Amount").refine((n) => n > 0, "Amount must be more than 0").refine((n) => n < 1e9, "Amount looks wrong"),
  paidTo: zf.text("Paid to"),
  method: z.enum(METHODS, { error: "Choose a payment method" }),
  description: zf.optText(),
  removeReceipt: zf.bool(),
});

async function receiptFrom(fd: FormData) {
  const f = fd.get("receipt");
  if (f instanceof File && f.size > 0) return (await saveUpload(f, "receipts", { kind: "document", maxMb: 10 })).relPath;
  return null;
}

export async function saveExpenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) throw new ActionError("Your session has expired. Please sign in again.");
    if (!canSubmitExpense(user)) throw new ActionError("You don't have permission to record expenses.");
    const { id, branchId: formBranch, removeReceipt, ...v } = parse(ExpenseSchema, formObject(fd));
    const branchId = await resolveWriteBranch(formBranch);
    const approver = canApproveExpense(user);

    if (id) {
      const before = await db.expense.findFirstOrThrow({ where: { id, deletedAt: null } });
      await assertBranchAccess(user, before.branchId);
      const own = before.addedById === user.id;
      if (!approver && !(own && (before.status === "PENDING" || before.status === "REJECTED")))
        throw new ActionError("Only pending expenses you submitted can be edited.");
      const newReceipt = await receiptFrom(fd);
      const resubmit = !approver && before.status === "REJECTED";
      const after = await db.expense.update({
        where: { id },
        data: {
          ...v,
          branchId,
          ...(newReceipt ? { receiptPath: newReceipt } : removeReceipt ? { receiptPath: null } : {}),
          ...(resubmit ? { status: "PENDING", rejectionReason: null, approvedById: null, approvedAt: null } : {}),
        },
      });
      await audit(user.id, "UPDATE", "Expense", id, `${resubmit ? "Edited & resubmitted" : "Edited"} expense ${after.code} — ${money(after.amount)} to ${after.paidTo}`, {
        branchId,
        changes: diff(before, after, ["date", "category", "amount", "paidTo", "method", "description", "branchId", "receiptPath", "status"]),
      });
      if (resubmit)
        await notifyUsers({ permission: "expenses.approve", branchId, title: "Expense resubmitted", body: `${after.code}: ${money(after.amount)} to ${after.paidTo} by ${user.name}`, link: "/expenses?status=PENDING" });
      return { ok: true, message: resubmit ? "Expense resubmitted for approval" : "Expense updated", id };
    }

    const receiptPath = await receiptFrom(fd);
    const exp = await db.$transaction(async (tx) =>
      tx.expense.create({
        data: {
          ...v,
          code: await nextExpenseCode(tx),
          branchId,
          receiptPath,
          addedById: user.id,
          // The owner/approver recording their own expense doesn't need a second sign-off.
          status: approver ? "APPROVED" : "PENDING",
          approvedById: approver ? user.id : null,
          approvedAt: approver ? new Date() : null,
        },
      }),
    );
    await audit(user.id, "CREATE", "Expense", exp.id, `Recorded expense ${exp.code} — ${money(exp.amount)} to ${exp.paidTo} (${EXPENSE_CATEGORY_LABEL[exp.category]})`, { branchId });
    if (!approver)
      await notifyUsers({
        permission: "expenses.approve",
        branchId,
        title: "Expense awaiting approval",
        body: `${exp.code}: ${money(exp.amount)} to ${exp.paidTo} (${EXPENSE_CATEGORY_LABEL[exp.category]}) by ${user.name}`,
        link: "/expenses?status=PENDING",
      });
    return { ok: true, message: approver ? `Expense ${exp.code} recorded` : `Expense ${exp.code} sent for approval`, id: exp.id };
  });
}

export async function approveExpenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("expenses.approve");
    const id = String(fd.get("id"));
    const e = await db.expense.findFirstOrThrow({ where: { id, deletedAt: null } });
    await assertBranchAccess(user, e.branchId);
    if (e.status !== "PENDING") throw new ActionError("This expense has already been reviewed.");
    await db.expense.update({ where: { id }, data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date(), rejectionReason: null } });
    await audit(user.id, "APPROVE", "Expense", id, `Approved expense ${e.code} — ${money(e.amount)} to ${e.paidTo}`, { branchId: e.branchId });
    if (e.addedById && e.addedById !== user.id)
      await notifyUsers({ userIds: [e.addedById], title: "Expense approved", body: `${e.code}: ${money(e.amount)} to ${e.paidTo} was approved by ${user.name}`, link: `/expenses?q=${e.code}` });
    return { ok: true, message: `${e.code} approved` };
  });
}

export async function rejectExpenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("expenses.approve");
    const { id, reason } = parse(z.object({ id: zf.id(), reason: zf.text("Reason", 3) }), formObject(fd));
    const e = await db.expense.findFirstOrThrow({ where: { id, deletedAt: null } });
    await assertBranchAccess(user, e.branchId);
    if (e.status !== "PENDING") throw new ActionError("This expense has already been reviewed.");
    await db.expense.update({ where: { id }, data: { status: "REJECTED", rejectionReason: reason, approvedById: user.id, approvedAt: new Date() } });
    await audit(user.id, "REJECT", "Expense", id, `Rejected expense ${e.code} — ${reason}`, { branchId: e.branchId });
    if (e.addedById && e.addedById !== user.id)
      await notifyUsers({ userIds: [e.addedById], title: "Expense rejected", body: `${e.code}: ${money(e.amount)} to ${e.paidTo} — ${reason}`, link: `/expenses?q=${e.code}` });
    return { ok: true, message: `${e.code} rejected` };
  });
}

export async function deleteExpenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) throw new ActionError("Your session has expired. Please sign in again.");
    const id = String(fd.get("id"));
    const e = await db.expense.findFirstOrThrow({ where: { id, deletedAt: null } });
    await assertBranchAccess(user, e.branchId);
    const own = e.addedById === user.id && e.status !== "APPROVED" && canSubmitExpense(user);
    if (!canApproveExpense(user) && !own) throw new ActionError("You can only delete your own expenses that are not yet approved.");
    await db.expense.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(user.id, "DELETE", "Expense", id, `Deleted expense ${e.code} — ${money(e.amount)} to ${e.paidTo} (${fmtDate(e.date)})`, { branchId: e.branchId });
    return { ok: true, message: `${e.code} deleted` };
  });
}

// ───────────────────────────── Activities ─────────────────────────────

const ActivitySchema = z.object({
  id: zf.optId(),
  branchId: zf.optId(),
  type: z.enum(Object.keys(ACTIVITY_TYPE_LABEL) as [string, ...string[]], { error: "Choose an activity type" }),
  title: zf.optText(),
  description: zf.optText(),
  date: zf.dateTime("Date & time"),
  extraItems: zf.optText(),
});

function checklistFrom(fd: FormData, labels: string[], extra: string | null): ChecklistItem[] {
  const done = new Set(fd.getAll("done").map(String));
  const extras = (extra ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...labels.map((label, i) => ({ label, done: done.has(String(i)) })), ...extras.map((label) => ({ label, done: false }))];
}

export async function saveActivityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("activities.create");
    const v = parse(ActivitySchema, formObject(fd));
    const branchId = await resolveWriteBranch(v.branchId);
    const title = v.title || ACTIVITY_TYPE_LABEL[v.type]!;

    let checklist: ChecklistItem[] | undefined;
    if (isChecklist(v.type)) {
      const labels = fd.getAll("label").map(String);
      checklist = checklistFrom(fd, labels.length ? labels : DEFAULT_CHECKLISTS[v.type], v.extraItems);
    }
    const allDone = checklist ? checklist.length > 0 && checklist.every((c) => c.done) : false;

    if (v.id) {
      const before = await db.activity.findFirstOrThrow({ where: { id: v.id, deletedAt: null } });
      await assertBranchAccess(user, before.branchId);
      if (before.status === "REVIEWED") throw new ActionError("Reviewed activities are locked.");
      const after = await db.activity.update({
        where: { id: v.id },
        data: {
          type: v.type as ActivityType,
          title,
          description: v.description,
          date: v.date,
          branchId,
          ...(checklist ? { checklist: checklist as unknown as Prisma.InputJsonValue, status: allDone ? "RESOLVED" : "OPEN" } : {}),
        },
      });
      await audit(user.id, "UPDATE", "Activity", after.id, `Updated activity “${after.title}”`, { branchId, changes: diff(before, after, ["type", "title", "description", "date", "status"]) });
      return { ok: true, message: "Activity updated", id: after.id };
    }

    const a = await db.activity.create({
      data: {
        branchId,
        type: v.type as ActivityType,
        title,
        description: v.description,
        date: v.date,
        checklist: checklist as unknown as Prisma.InputJsonValue | undefined,
        status: allDone ? "RESOLVED" : "OPEN",
        createdById: user.id,
      },
    });
    await audit(user.id, "CREATE", "Activity", a.id, `Recorded ${ACTIVITY_TYPE_LABEL[v.type]?.toLowerCase()}: “${title}”`, { branchId });
    if (v.type === "PATIENT_COMPLAINT" || v.type === "EQUIPMENT_REPAIR")
      await notifyUsers({
        permission: "expenses.approve",
        branchId,
        title: v.type === "PATIENT_COMPLAINT" ? "Patient complaint recorded" : "Equipment repair needed",
        body: `${title}${v.description ? ` — ${v.description.slice(0, 120)}` : ""} (by ${user.name})`,
        link: "/expenses?tab=activities&status=OPEN",
      });
    return { ok: true, message: "Activity recorded", id: a.id };
  });
}

/** Start today's opening/closing checklist for a branch from the default template. */
export async function startChecklistAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("activities.create");
    const type = String(fd.get("type"));
    if (!isChecklist(type)) throw new ActionError("Unknown checklist.");
    const branchId = String(fd.get("branchId"));
    await assertBranchAccess(user, branchId);
    const { start, end } = istDayRange();
    const existing = await db.activity.findFirst({ where: { branchId, type, deletedAt: null, date: { gte: start, lt: end } } });
    if (existing) return { ok: true, message: "Today's checklist is already started", id: existing.id };
    const a = await db.activity.create({
      data: {
        branchId,
        type,
        title: ACTIVITY_TYPE_LABEL[type]!,
        checklist: DEFAULT_CHECKLISTS[type].map((label) => ({ label, done: false })),
        date: new Date(),
        status: "OPEN",
        createdById: user.id,
      },
    });
    await audit(user.id, "CREATE", "Activity", a.id, `Started ${ACTIVITY_TYPE_LABEL[type]!.toLowerCase()}`, { branchId });
    return { ok: true, message: "Checklist started — tick items as you go", id: a.id };
  });
}

export async function updateChecklistAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("activities.create");
    const id = String(fd.get("id"));
    const a = await db.activity.findFirstOrThrow({ where: { id, deletedAt: null } });
    await assertBranchAccess(user, a.branchId);
    if (a.status === "REVIEWED") throw new ActionError("This checklist has been reviewed and is locked.");
    const items = parseChecklist(a.checklist);
    const done = new Set(fd.getAll("done").map(String));
    const next = items.map((it, i) => ({ ...it, done: done.has(String(i)) }));
    const extra = String(fd.get("extraItems") ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((label) => ({ label, done: false }));
    const all = [...next, ...extra];
    const complete = all.length > 0 && all.every((c) => c.done);
    const note = String(fd.get("description") ?? "").trim();
    await db.activity.update({
      where: { id },
      data: { checklist: all as unknown as Prisma.InputJsonValue, status: complete ? "RESOLVED" : "OPEN", ...(note ? { description: note } : {}) },
    });
    await audit(user.id, "UPDATE", "Activity", id, `Updated ${a.title.toLowerCase()} — ${all.filter((c) => c.done).length}/${all.length} done`, { branchId: a.branchId });
    return { ok: true, message: complete ? "Checklist complete" : "Checklist saved" };
  });
}

export async function setActivityStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) throw new ActionError("Your session has expired. Please sign in again.");
    const id = String(fd.get("id"));
    const status = String(fd.get("status")) as ActivityStatus;
    if (!["OPEN", "RESOLVED", "REVIEWED"].includes(status)) throw new ActionError("Unknown status.");
    const a = await db.activity.findFirstOrThrow({ where: { id, deletedAt: null } });
    await assertBranchAccess(user, a.branchId);
    if (status === "REVIEWED" || a.status === "REVIEWED") {
      if (!canReviewActivity(user)) throw new ActionError("Only a manager or the owner can review activities.");
    } else if (!user.permissions.has("activities.create")) throw new ActionError("You don't have permission to update activities.");
    await db.activity.update({
      where: { id },
      data: { status, ...(status === "REVIEWED" ? { reviewedById: user.id, reviewedAt: new Date() } : { reviewedById: null, reviewedAt: null }) },
    });
    await audit(user.id, status === "REVIEWED" ? "APPROVE" : "STATUS", "Activity", id, `${status === "REVIEWED" ? "Reviewed" : status === "RESOLVED" ? "Resolved" : "Reopened"} “${a.title}”`, { branchId: a.branchId });
    if (status === "RESOLVED" && a.createdById && a.createdById !== user.id && a.type === "PATIENT_COMPLAINT")
      await notifyUsers({ userIds: [a.createdById], title: "Complaint resolved", body: `“${a.title}” was marked resolved by ${user.name}`, link: "/expenses?tab=activities" });
    return { ok: true, message: status === "REVIEWED" ? "Marked as reviewed" : status === "RESOLVED" ? "Marked as resolved" : "Reopened" };
  });
}

export async function deleteActivityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) throw new ActionError("Your session has expired. Please sign in again.");
    const id = String(fd.get("id"));
    const a = await db.activity.findFirstOrThrow({ where: { id, deletedAt: null } });
    await assertBranchAccess(user, a.branchId);
    const own = a.createdById === user.id && a.status !== "REVIEWED" && user.permissions.has("activities.create");
    if (!own && !canReviewActivity(user)) throw new ActionError("You can only delete activities you recorded.");
    await db.activity.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(user.id, "DELETE", "Activity", id, `Deleted activity “${a.title}”`, { branchId: a.branchId });
    return { ok: true, message: "Activity deleted" };
  });
}
