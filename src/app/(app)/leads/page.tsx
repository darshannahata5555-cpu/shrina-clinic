import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { CalendarClock, MessageCircle, Megaphone, Phone, Plus, Target, TrendingUp, Users } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { addDaysKey, cn, fmtDate, fmtDateShort, fromIst, initials, istDateKey, istDayRange, moneyShort, relativeDays, toNum } from "@/lib/format";
import { LEAD_SOURCES, STATUS } from "@/lib/status";
import { PageHeader, Pagination, withParams } from "@/components/ui/page";
import { Card, CardHeader, EmptyState, StatCard } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DateParam, FilterBar, SearchParamInput, SegmentParam, SelectParam } from "@/components/ui/filters";
import { Table, TableEmpty, TD, TH, THead, TR } from "@/components/ui/table";
import { LeadForm, MoveLeadSelect } from "./lead-form";
import { assignableUsers, LEAD_PIPELINE, OPEN_STATUSES, treatmentNames } from "./data";

export const metadata = { title: "Leads & CRM" };

const PAGE = 25;
const SOURCE_LABEL = Object.fromEntries(LEAD_SOURCES) as Record<string, string>;
const waLink = (mobile: string, name: string) =>
  `https://wa.me/91${mobile}?text=${encodeURIComponent(`Hi ${name.split(" ")[0]}, this is SHRINA Clinic following up on your enquiry.`)}`;

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const user = await requirePermission(["leads.view", "leads.manage"]);
  const scope = await getBranchScope();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const view = str("view") === "list" ? "list" : "board";
  const page = Math.max(1, Number(sp.page) || 1);
  const manage = can(user, "leads.manage");
  const today = istDateKey();
  const { start: todayStart, end: todayEnd } = istDayRange(today);

  const q = str("q").trim();
  const digits = q.replace(/\D/g, "");
  const due = str("due");
  const where: Prisma.LeadWhereInput = {
    deletedAt: null,
    branchId: { in: scope.ids },
    ...(q
      ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, ...(digits.length >= 3 ? [{ mobile: { contains: digits } }] : []), { interestedTreatment: { contains: q, mode: "insensitive" } }] }
      : {}),
    ...(str("source") ? { source: str("source") as never } : {}),
    ...(str("assigned") ? { assignedToId: str("assigned") === "none" ? null : str("assigned") } : {}),
    ...(view === "list" && str("status") ? { status: str("status") as never } : {}),
    ...(str("from") || str("to")
      ? { enquiryDate: { ...(str("from") ? { gte: fromIst(str("from")) } : {}), ...(str("to") ? { lt: fromIst(addDaysKey(str("to"), 1)) } : {}) } }
      : {}),
    ...(due === "today"
      ? { followUpDate: { gte: todayStart, lt: todayEnd }, status: { in: [...OPEN_STATUSES] } }
      : due === "overdue"
        ? { followUpDate: { lt: todayStart }, status: { in: [...OPEN_STATUSES] } }
        : due === "week"
          ? { followUpDate: { gte: todayStart, lt: new Date(todayEnd.getTime() + 6 * 86400000) }, status: { in: [...OPEN_STATUSES] } }
          : {}),
  };

  const base = { deletedAt: null, branchId: { in: scope.ids } } satisfies Prisma.LeadWhereInput;
  const d30 = new Date(todayStart.getTime() - 30 * 86400000);
  const [users, treatments, openCount, newWeek, dueRows, cohort, pipeline] = await Promise.all([
    assignableUsers(scope.ids),
    treatmentNames(),
    db.lead.count({ where: { ...base, status: { in: [...OPEN_STATUSES] } } }),
    db.lead.count({ where: { ...base, enquiryDate: { gte: new Date(todayStart.getTime() - 6 * 86400000) } } }),
    db.lead.findMany({
      where: { ...base, status: { in: [...OPEN_STATUSES] }, followUpDate: { lt: todayEnd } },
      include: { assignedTo: { select: { name: true } } },
      orderBy: { followUpDate: "asc" },
      take: 8,
    }),
    db.lead.groupBy({ by: ["status"], where: { ...base, enquiryDate: { gte: d30 } }, _count: true }),
    db.lead.aggregate({ where: { ...base, status: { in: [...OPEN_STATUSES] } }, _sum: { estimatedValue: true } }),
  ]);
  const dueCount = await db.lead.count({ where: { ...base, status: { in: [...OPEN_STATUSES] }, followUpDate: { lt: todayEnd } } });
  const cohortTotal = cohort.reduce((s, r) => s + r._count, 0);
  const cohortWon = cohort.find((r) => r.status === "TREATMENT_PURCHASED")?._count ?? 0;
  const branchOpts = scope.branches.map((b) => ({ id: b.id, name: b.name }));

  return (
    <>
      <PageHeader
        title="Leads & CRM"
        description="Enquiries from Instagram, Google, WhatsApp, referrals and walk-ins — from first message to paying patient."
        actions={
          <>
            <SegmentParam name="view" defaultValue="board" options={[["board", "Pipeline"], ["list", "List"]]} />
            {manage && (
              <Dialog title="New lead" size="lg" trigger={<Button><Plus className="h-4 w-4" /> New lead</Button>}>
                <LeadForm branches={scope.current ? [{ id: scope.current.id, name: scope.current.name }] : branchOpts} users={users} treatments={treatments} currentUserId={user.id} />
              </Dialog>
            )}
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Open leads" value={openCount} hint={`${newWeek} new in the last 7 days`} icon={<Users className="h-[18px] w-[18px]" />} tone="info" />
        <StatCard label="Follow-ups due" value={dueCount} hint="Today and overdue" icon={<CalendarClock className="h-[18px] w-[18px]" />} tone={dueCount ? "warning" : "success"} href="/leads?view=list&due=overdue" />
        <StatCard
          label="Conversion (30 days)"
          value={cohortTotal ? `${Math.round((cohortWon / cohortTotal) * 100)}%` : "—"}
          hint={`${cohortWon} of ${cohortTotal} enquiries purchased`}
          icon={<Target className="h-[18px] w-[18px]" />}
          tone="success"
          href="/reports?tab=business"
        />
        <StatCard label="Open pipeline value" value={moneyShort(toNum(pipeline._sum.estimatedValue))} hint="Sum of estimated values" icon={<TrendingUp className="h-[18px] w-[18px]" />} tone="accent" />
      </div>

      {dueRows.length > 0 && (
        <Card className="mb-5">
          <CardHeader
            title="Follow-ups due"
            description="Call or message these leads today."
            actions={<Link href="/leads?view=list&due=overdue" className="text-[13px] text-accent hover:underline">See all overdue →</Link>}
          />
          <ul className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
            {dueRows.map((l) => {
              const overdue = l.followUpDate! < todayStart;
              return (
                <li key={l.id} className="flex items-center gap-3 border-border px-4 py-2.5 sm:border-b sm:px-5 sm:odd:border-r">
                  <div className="min-w-0 flex-1">
                    <Link href={`/leads/${l.id}`} className="block truncate text-sm font-medium hover:text-accent">
                      {l.name}
                    </Link>
                    <p className="truncate text-xs text-muted">
                      {l.interestedTreatment ?? "General enquiry"} · {l.assignedTo?.name ?? "Unassigned"}
                    </p>
                  </div>
                  <span className={cn("shrink-0 text-xs", overdue ? "font-medium text-danger" : "text-warning")}>{overdue ? relativeDays(l.followUpDate) : "today"}</span>
                  <a href={`tel:+91${l.mobile}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-3 hover:text-ink" aria-label={`Call ${l.name}`}>
                    <Phone className="h-4 w-4" />
                  </a>
                  <a href={waLink(l.mobile, l.name)} target="_blank" rel="noreferrer" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-3 hover:text-success" aria-label={`WhatsApp ${l.name}`}>
                    <MessageCircle className="h-4 w-4" />
                  </a>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <FilterBar className="mb-4">
        <SearchParamInput placeholder="Search name, mobile, code, interest" />
        <SelectParam name="source" placeholder="All sources" options={LEAD_SOURCES} />
        <SelectParam name="assigned" placeholder="Anyone" options={[["none", "Unassigned"] as const, ...users.map((u) => [u.id, u.name] as const)]} />
        {view === "list" && <SelectParam name="status" placeholder="All stages" options={Object.entries(STATUS.lead).map(([k, v]) => [k, v[1]] as const)} />}
        <SelectParam name="due" placeholder="Any follow-up" options={[["today", "Due today"], ["overdue", "Overdue"], ["week", "Due this week"]]} />
        <DateParam name="from" label="Enquired" />
        <DateParam name="to" label="to" />
      </FilterBar>

      {view === "board" ? <Board where={where} manage={manage} showBranch={scope.isAll} sp={sp} /> : <List where={where} page={page} sp={sp} showBranch={scope.isAll} />}
    </>
  );
}

async function Board({ where, manage, showBranch, sp }: { where: Prisma.LeadWhereInput; manage: boolean; showBranch: boolean; sp: Record<string, string | string[] | undefined> }) {
  const PER = 40;
  const today = istDayRange().start;
  const [columns, lostCount] = await Promise.all([
    Promise.all(
      LEAD_PIPELINE.map(async (status) => {
        const w = { ...where, status } as Prisma.LeadWhereInput;
        const [rows, count, value] = await Promise.all([
          db.lead.findMany({
            where: w,
            include: { assignedTo: { select: { name: true } }, branch: { select: { code: true } } },
            orderBy: status === "TREATMENT_PURCHASED" ? [{ convertedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }] : [{ followUpDate: { sort: "asc", nulls: "last" } }, { enquiryDate: "desc" }],
            take: PER,
          }),
          db.lead.count({ where: w }),
          db.lead.aggregate({ where: w, _sum: { estimatedValue: true } }),
        ]);
        return { status, rows, count, value: toNum(value._sum.estimatedValue) };
      }),
    ),
    db.lead.count({ where: { ...where, status: "LOST" } as Prisma.LeadWhereInput }),
  ]);

  return (
    <div className="scroll-thin -mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
      <div className="grid min-w-[1180px] grid-cols-[repeat(5,minmax(0,1fr))_150px] gap-3">
        {columns.map((col) => (
          <section key={col.status} className="flex min-h-48 flex-col rounded-xl border border-border bg-surface-2">
            <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
              <StatusBadge kind="lead" status={col.status} />
              <span className="tabular text-xs text-muted">
                {col.count}
                {col.value > 0 && ` · ${moneyShort(col.value)}`}
              </span>
            </header>
            <ul className="flex-1 space-y-2 p-2">
              {col.rows.length === 0 && <li className="px-2 py-6 text-center text-xs text-muted">No leads</li>}
              {col.rows.map((l) => {
                const overdue = l.followUpDate && l.followUpDate < today;
                return (
                  <li key={l.id} className="rounded-lg border border-border bg-surface p-2.5 shadow-card">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/leads/${l.id}`} className="min-w-0 text-[13.5px] font-medium leading-snug text-ink hover:text-accent">
                        {l.name}
                      </Link>
                      {l.assignedTo && (
                        <span title={l.assignedTo.name} className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-3 text-[10px] font-semibold text-ink-2">
                          {initials(l.assignedTo.name)}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted">{l.interestedTreatment ?? "General enquiry"}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <Badge tone="neutral">{SOURCE_LABEL[l.source] ?? l.source}</Badge>
                      {showBranch && <span className="text-muted">{l.branch.code}</span>}
                      {l.estimatedValue && <span className="tabular text-muted">{moneyShort(toNum(l.estimatedValue))}</span>}
                      {l.followUpDate && col.status !== "TREATMENT_PURCHASED" && (
                        <span className={cn("ml-auto", overdue ? "font-medium text-danger" : "text-muted")}>↻ {fmtDateShort(l.followUpDate)}</span>
                      )}
                    </div>
                    {manage && (
                      <div className="mt-2">
                        <MoveLeadSelect id={l.id} status={l.status} />
                      </div>
                    )}
                  </li>
                );
              })}
              {col.count > col.rows.length && (
                <li className="text-center">
                  <Link href={withParams("/leads", sp, { view: "list", status: col.status })} className="text-xs text-accent hover:underline">
                    +{col.count - col.rows.length} more
                  </Link>
                </li>
              )}
            </ul>
          </section>
        ))}
        <section className="flex flex-col rounded-xl border border-dashed border-border-strong bg-surface-2/50">
          <header className="border-b border-border px-3 py-2.5">
            <StatusBadge kind="lead" status="LOST" />
          </header>
          <div className="flex flex-1 flex-col items-center justify-center gap-1 p-3 text-center">
            <p className="tabular text-2xl font-semibold text-ink-2">{lostCount}</p>
            <Link href={withParams("/leads", sp, { view: "list", status: "LOST" })} className="text-xs text-accent hover:underline">
              View lost leads
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

async function List({ where, page, sp, showBranch }: { where: Prisma.LeadWhereInput; page: number; sp: Record<string, string | string[] | undefined>; showBranch: boolean }) {
  const [rows, total] = await Promise.all([
    db.lead.findMany({
      where,
      include: { assignedTo: { select: { name: true } }, branch: { select: { code: true } }, patient: { select: { id: true, code: true } } },
      orderBy: { enquiryDate: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
    }),
    db.lead.count({ where }),
  ]);
  const today = istDayRange().start;
  return (
    <Card>
      {total === 0 ? (
        <EmptyState icon={<Megaphone className="h-5 w-5" />} title="No leads found" description="Try clearing filters, or add a new enquiry." />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Lead</TH>
              <TH className="hidden md:table-cell">Interested in</TH>
              <TH className="hidden lg:table-cell">Source</TH>
              <TH className="hidden sm:table-cell">Enquired</TH>
              <TH>Stage</TH>
              <TH className="hidden md:table-cell">Follow-up</TH>
              <TH className="hidden xl:table-cell">Assigned</TH>
            </tr>
          </THead>
          <tbody>
            {rows.length === 0 && <TableEmpty colSpan={7}>No leads on this page.</TableEmpty>}
            {rows.map((l) => (
              <TR key={l.id}>
                <TD>
                  <Link href={`/leads/${l.id}`} className="font-medium hover:text-accent">
                    {l.name}
                  </Link>
                  <p className="text-xs text-muted">
                    {l.code} · {l.mobile}
                    {showBranch && ` · ${l.branch.code}`}
                    {l.patient && ` · ${l.patient.code}`}
                  </p>
                </TD>
                <TD className="hidden text-ink-2 md:table-cell">{l.interestedTreatment ?? "—"}</TD>
                <TD className="hidden text-ink-2 lg:table-cell">{SOURCE_LABEL[l.source]}</TD>
                <TD className="tabular hidden whitespace-nowrap text-ink-2 sm:table-cell">{fmtDate(l.enquiryDate)}</TD>
                <TD>
                  <StatusBadge kind="lead" status={l.status} />
                  {l.status === "LOST" && l.lostReason && <p className="mt-0.5 max-w-40 truncate text-[11px] text-muted">{l.lostReason}</p>}
                </TD>
                <TD className={cn("hidden whitespace-nowrap md:table-cell", l.followUpDate && l.followUpDate < today && !["LOST", "TREATMENT_PURCHASED"].includes(l.status) ? "font-medium text-danger" : "text-ink-2")}>
                  {l.followUpDate ? fmtDate(l.followUpDate) : "—"}
                </TD>
                <TD className="hidden text-ink-2 xl:table-cell">{l.assignedTo?.name ?? "—"}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE} total={total} hrefFor={(p) => withParams("/leads", sp, { page: p })} />
    </Card>
  );
}
