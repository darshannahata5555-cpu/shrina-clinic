import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { fmtDateTime, fromIst, addDaysKey } from "@/lib/format";
import { PageHeader, Pagination, withParams } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TH, TR, TD, TableEmpty } from "@/components/ui/table";
import { DateParam, FilterBar, SearchParamInput, SelectParam } from "@/components/ui/filters";
import type { Tone } from "@/lib/status";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Activity log" };

const ACTION_TONE: Record<string, Tone> = {
  CREATE: "success", UPDATE: "info", DELETE: "danger", RESTORE: "violet", APPROVE: "success", REJECT: "danger", CANCEL: "danger",
  PAYMENT: "success", REFUND: "warning", TRANSFER: "violet", STATUS: "info", LOGIN: "neutral", LOGOUT: "neutral",
  LOGIN_FAILED: "danger", EXPORT: "warning", IMPORT: "warning", PERMISSIONS: "accent",
};

const PAGE = 50;

export default async function AuditPage({ searchParams }: PageProps<"/settings/audit">) {
  await requirePermission("audit.view");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const page = Math.max(1, Number(s("page")) || 1);

  const where: Prisma.AuditLogWhereInput = {
    ...(s("user") ? { userId: s("user") } : {}),
    ...(s("action") ? { action: s("action") } : {}),
    ...(s("entity") ? { entity: s("entity") } : {}),
    ...(s("q") ? { OR: [{ summary: { contains: s("q"), mode: "insensitive" } }, { entityId: s("q") }] } : {}),
    ...(s("from") || s("to")
      ? { createdAt: { ...(s("from") ? { gte: fromIst(s("from")) } : {}), ...(s("to") ? { lt: fromIst(addDaysKey(s("to"), 1)) } : {}) } }
      : {}),
  };

  const [rows, total, users, entities, actions] = await Promise.all([
    db.auditLog.findMany({ where, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    db.auditLog.count({ where }),
    db.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.auditLog.findMany({ distinct: ["entity"], select: { entity: true }, orderBy: { entity: "asc" } }),
    db.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Activity log"
        description="Tamper-evident record of sign-ins, edits, deletions, approvals and every financial change."
      />
      <Card>
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <FilterBar>
            <SearchParamInput placeholder="Search description or record ID" />
            <SelectParam name="user" placeholder="All users" options={users.map((u) => [u.id, u.name] as const)} />
            <SelectParam name="action" placeholder="All actions" options={actions.map((a) => [a.action, a.action.replace(/_/g, " ").toLowerCase()] as const)} />
            <SelectParam name="entity" placeholder="All records" options={entities.map((e) => [e.entity, e.entity] as const)} />
            <DateParam name="from" label="From" />
            <DateParam name="to" label="To" />
          </FilterBar>
        </div>
        <Table>
          <THead>
            <tr>
              <TH>When</TH>
              <TH>User</TH>
              <TH>Action</TH>
              <TH>Description</TH>
              <TH className="hidden lg:table-cell">IP</TH>
            </tr>
          </THead>
          <tbody>
            {rows.length === 0 && <TableEmpty colSpan={5}>No activity matches these filters.</TableEmpty>}
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="whitespace-nowrap text-xs text-muted tabular">{fmtDateTime(r.createdAt)}</TD>
                <TD className="whitespace-nowrap text-[13px]">{r.user?.name ?? <span className="text-muted">System</span>}</TD>
                <TD>
                  <Badge tone={ACTION_TONE[r.action] ?? "neutral"}>{r.action.replace(/_/g, " ").toLowerCase()}</Badge>
                </TD>
                <TD className="max-w-xl text-[13px]">
                  <span className="text-ink">{r.summary}</span>
                  <span className="ml-1.5 text-xs text-muted">{r.entity}</span>
                  {r.changes && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-accent">Show changes</summary>
                      <pre className="scroll-thin mt-1 max-h-60 overflow-auto rounded-md bg-surface-2 p-2 text-[11px] leading-relaxed text-ink-2">
                        {JSON.stringify(r.changes, null, 2)}
                      </pre>
                    </details>
                  )}
                </TD>
                <TD className="hidden text-xs text-muted lg:table-cell">{r.ip ?? "—"}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
        <Pagination page={page} pageSize={PAGE} total={total} hrefFor={(p) => withParams("/settings/audit", sp, { page: p })} />
      </Card>
    </>
  );
}
