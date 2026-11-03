import { CheckCircle2, ClipboardList, ListChecks, Pencil, Plus, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import type { ActivityStatus, ActivityType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import type { BranchScope } from "@/lib/branch";
import { addDaysKey, cn, fmtDateTime, fromIst, istDayRange, toIstLocalInput } from "@/lib/format";
import { Pagination, withParams } from "@/components/ui/page";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionButton } from "@/components/ui/form";
import { DateParam, FilterBar, SelectParam } from "@/components/ui/filters";
import { canRecordActivity, canReviewActivity, seesAllActivities } from "./_lib/access";
import { ACTIVITY_TYPE_LABEL, ACTIVITY_TYPE_TONE, ACTIVITY_TYPES, isChecklist, parseChecklist } from "./_lib/labels";
import { ActivityForm, ChecklistForm } from "./forms";
import { deleteActivityAction, setActivityStatusAction, startChecklistAction } from "./actions";

const PAGE_SIZE = 20;
type SP = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export async function ActivitiesTab({ user, scope, sp }: { user: CurrentUser; scope: BranchScope; sp: SP }) {
  const page = Math.max(1, Number(sp.page) || 1);
  // Params are shared with the expenses tab (?status=PENDING) — accept only valid activity values.
  const type = Object.hasOwn(ACTIVITY_TYPE_LABEL, str(sp.type)) ? str(sp.type) : "";
  const status = ["OPEN", "RESOLVED", "REVIEWED"].includes(str(sp.status)) ? str(sp.status) : "";
  const from = str(sp.from);
  const to = str(sp.to);
  const all = seesAllActivities(user);
  const canRecord = canRecordActivity(user);
  const reviewer = canReviewActivity(user);

  const where: Prisma.ActivityWhereInput = {
    deletedAt: null,
    branchId: { in: scope.ids },
    ...(all ? {} : { createdById: user.id }),
    ...(type ? { type: type as ActivityType } : {}),
    ...(status ? { status: status as ActivityStatus } : {}),
    ...(from || to ? { date: { ...(from ? { gte: fromIst(from) } : {}), ...(to ? { lt: fromIst(addDaysKey(to, 1)) } : {}) } } : {}),
  };
  const { start, end } = istDayRange();
  const branches = scope.branches.filter((b) => scope.ids.includes(b.id));
  const [total, activities, todays] = await Promise.all([
    db.activity.count({ where }),
    db.activity.findMany({ where, include: { branch: { select: { code: true } } }, orderBy: { date: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.activity.findMany({
      where: { deletedAt: null, branchId: { in: branches.map((b) => b.id) }, type: { in: ["OPENING_CHECKLIST", "CLOSING_CHECKLIST"] }, date: { gte: start, lt: end } },
      orderBy: { date: "desc" },
    }),
  ]);
  const people = await db.user.findMany({
    where: { id: { in: [...new Set(activities.flatMap((a) => [a.createdById, a.reviewedById]).filter(Boolean) as string[])] } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const branchOpts = scope.branches.map((b) => [b.id, b.name] as const);
  const now = toIstLocalInput(new Date());

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{all ? "Internal clinic activity log, checklists and complaints." : "Activities you have recorded."}</p>
        {canRecord && (
          <Dialog title="Record activity" trigger={<Button><Plus className="h-4 w-4" /> Record activity</Button>}>
            <ActivityForm branches={branchOpts} defaultBranchId={scope.defaultBranchId} now={now} />
          </Dialog>
        )}
      </div>

      {(all || canRecord) && (
        <div className="mb-5 grid gap-3 md:grid-cols-2">
          {branches.flatMap((b) =>
            (["OPENING_CHECKLIST", "CLOSING_CHECKLIST"] as const).map((t) => {
              const a = todays.find((x) => x.branchId === b.id && x.type === t);
              const items = a ? parseChecklist(a.checklist) : [];
              const done = items.filter((i) => i.done).length;
              const complete = items.length > 0 && done === items.length;
              return (
                <div key={`${b.id}-${t}`} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-card">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <ListChecks className={cn("h-4 w-4", complete ? "text-success" : a ? "text-warning" : "text-muted")} />
                      {t === "OPENING_CHECKLIST" ? "Opening" : "Closing"} checklist
                      {branches.length > 1 && <span className="text-xs font-normal text-muted">· {b.name}</span>}
                    </p>
                    <p className={cn("mt-0.5 text-xs", complete ? "text-success" : a ? "text-warning" : "text-muted")}>
                      {!a ? "Not started today" : complete ? `Complete · ${done}/${items.length}` : `${done} of ${items.length} done`}
                    </p>
                  </div>
                  {a ? (
                    <Dialog title={`${ACTIVITY_TYPE_LABEL[t]} — ${b.name}`} description={fmtDateTime(a.date)} trigger={<Button variant={complete ? "ghost" : "outline"} size="sm">{complete ? "View" : "Continue"}</Button>}>
                      <ChecklistForm id={a.id} items={items} description={a.description} locked={a.status === "REVIEWED" || !canRecord} />
                    </Dialog>
                  ) : canRecord ? (
                    <ActionButton action={startChecklistAction} fields={{ type: t, branchId: b.id }} variant="soft">
                      Start
                    </ActionButton>
                  ) : null}
                </div>
              );
            }),
          )}
        </div>
      )}

      <Card>
        <CardHeader
          title="Activity log"
          actions={
            <FilterBar>
              <SelectParam name="type" placeholder="All types" options={ACTIVITY_TYPES} />
              <SelectParam name="status" placeholder="Any status" options={[["OPEN", "Open"], ["RESOLVED", "Resolved"], ["REVIEWED", "Reviewed"]]} />
              <DateParam name="from" label="From" />
              <DateParam name="to" label="To" />
            </FilterBar>
          }
        />
        {activities.length === 0 ? (
          <EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No activities found" description="Machine maintenance, stock received, repairs, complaints and checklists appear here." />
        ) : (
          <ul className="divide-y divide-border">
            {activities.map((a) => {
              const items = isChecklist(a.type) ? parseChecklist(a.checklist) : [];
              const done = items.filter((i) => i.done).length;
              const own = a.createdById === user.id;
              const locked = a.status === "REVIEWED";
              return (
                <li key={a.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={ACTIVITY_TYPE_TONE[a.type] ?? "neutral"}>{ACTIVITY_TYPE_LABEL[a.type]}</Badge>
                      <StatusBadge kind="activity" status={a.status} />
                      {scope.isAll && <span className="text-[11px] text-muted">{a.branch.code}</span>}
                    </div>
                    <p className="mt-1.5 font-medium">{a.title}</p>
                    {a.description && <p className="mt-0.5 text-sm whitespace-pre-line text-ink-2">{a.description}</p>}
                    {items.length > 0 && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-3">
                          <div className="h-full rounded-full bg-success" style={{ width: `${(done / items.length) * 100}%` }} />
                        </div>
                        <span className="text-xs text-muted">
                          {done}/{items.length} done
                          {done < items.length && ` · missing: ${items.filter((i) => !i.done).map((i) => i.label).slice(0, 2).join(", ")}${items.length - done > 2 ? "…" : ""}`}
                        </span>
                      </div>
                    )}
                    <p className="mt-1.5 text-xs text-muted">
                      {fmtDateTime(a.date)} · by {(a.createdById && nameOf.get(a.createdById)) || "—"}
                      {a.reviewedById && ` · reviewed by ${nameOf.get(a.reviewedById) ?? "—"}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    {items.length > 0 && (
                      <Dialog title={a.title} description={fmtDateTime(a.date)} trigger={<Button variant="outline" size="sm"><ListChecks className="h-3.5 w-3.5" /> Checklist</Button>}>
                        <ChecklistForm id={a.id} items={items} description={a.description} locked={locked || !canRecord} />
                      </Dialog>
                    )}
                    {canRecord && a.status === "OPEN" && !isChecklist(a.type) && (
                      <ActionButton action={setActivityStatusAction} fields={{ id: a.id, status: "RESOLVED" }} variant="soft">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                      </ActionButton>
                    )}
                    {reviewer && a.status !== "REVIEWED" && (
                      <ActionButton action={setActivityStatusAction} fields={{ id: a.id, status: "REVIEWED" }} variant="outline">
                        <ShieldCheck className="h-3.5 w-3.5" /> Mark reviewed
                      </ActionButton>
                    )}
                    {((reviewer && locked) || (canRecord && a.status === "RESOLVED" && !isChecklist(a.type))) && (
                      <ActionButton action={setActivityStatusAction} fields={{ id: a.id, status: "OPEN" }} variant="ghost" title="Reopen">
                        <RotateCcw className="h-3.5 w-3.5" />
                      </ActionButton>
                    )}
                    {canRecord && !locked && (own || reviewer) && (
                      <Dialog
                        title="Edit activity"
                        trigger={
                          <Button variant="ghost" size="icon" title="Edit" aria-label="Edit">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        }
                      >
                        <ActivityForm
                          branches={branchOpts}
                          now={now}
                          values={{ id: a.id, branchId: a.branchId, type: a.type, title: a.title, description: a.description, date: toIstLocalInput(a.date), checklist: items }}
                        />
                      </Dialog>
                    )}
                    {((own && !locked && canRecord) || reviewer) && (
                      <ActionButton action={deleteActivityAction} fields={{ id: a.id }} variant="ghost" size="icon" title="Delete" confirm={`Delete “${a.title}”?`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </ActionButton>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(p) => withParams("/expenses", sp, { page: p })} />
      </Card>
    </>
  );
}
