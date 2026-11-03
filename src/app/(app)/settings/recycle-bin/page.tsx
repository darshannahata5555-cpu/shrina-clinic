import { Archive } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { fmtDateTime, humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { Card, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/ui/form";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { SelectParam, FilterBar } from "@/components/ui/filters";
import { RECYCLE_TYPES } from "./types";
import { restoreAction } from "./actions";

export const metadata = { title: "Recycle bin" };

type Row = { type: (typeof RECYCLE_TYPES)[number]; id: string; label: string; sub: string | null; deletedAt: Date };

export default async function RecycleBinPage({ searchParams }: PageProps<"/settings/recycle-bin">) {
  await requirePermission("recycle.manage");
  const scope = await getBranchScope();
  const sp = await searchParams;
  const only = typeof sp.type === "string" ? sp.type : "";
  const types = RECYCLE_TYPES.filter((t) => !only || t.key === only);

  const lists = await Promise.all(
    types.map(async (t) => {
      const delegate = (db as unknown as Record<string, { findMany: (a: object) => Promise<Record<string, unknown>[]> }>)[t.model]!;
      const rows = await delegate.findMany({
        where: { deletedAt: { not: null }, ...(t.branch ? { branchId: { in: scope.ids } } : {}) },
        orderBy: { deletedAt: "desc" },
        take: 100,
      });
      return rows.map(
        (r): Row => ({
          type: t,
          id: r.id as string,
          label: String(r[t.labelField] ?? "—"),
          sub: t.sub ? humanize(String(r[t.sub] ?? "")) : null,
          deletedAt: r.deletedAt as Date,
        }),
      );
    }),
  );
  const rows = lists.flat().sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());

  // who deleted (from audit log)
  const logs = rows.length
    ? await db.auditLog.findMany({
        where: { action: "DELETE", entityId: { in: rows.map((r) => r.id) } },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const deletedBy = new Map<string, string>();
  for (const l of logs) if (l.entityId && !deletedBy.has(l.entityId)) deletedBy.set(l.entityId, l.user?.name ?? "System");

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Recycle bin"
        description="Deleted records are kept, never erased. Restore anything deleted by mistake — the restore is logged."
      />
      <Card>
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <FilterBar>
            <SelectParam name="type" placeholder="All record types" options={RECYCLE_TYPES.map((t) => [t.key, t.label] as const)} />
          </FilterBar>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<Archive className="h-5 w-5" />} title="Recycle bin is empty" description="Nothing has been deleted in your branches." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Record</TH>
                <TH>Type</TH>
                <TH className="hidden md:table-cell">Deleted</TH>
                <TH className="text-right">Action</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => (
                <TR key={`${r.type.key}:${r.id}`}>
                  <TD>
                    <p className="font-medium">{r.label}</p>
                    {r.sub && <p className="text-xs text-muted">{r.sub}</p>}
                  </TD>
                  <TD>
                    <Badge tone="neutral">{r.type.label}</Badge>
                  </TD>
                  <TD className="hidden text-[13px] text-ink-2 md:table-cell">
                    {fmtDateTime(r.deletedAt)}
                    {deletedBy.get(r.id) && <span className="text-muted"> · by {deletedBy.get(r.id)}</span>}
                  </TD>
                  <TD className="text-right">
                    <ActionButton action={restoreAction} fields={{ type: r.type.key, id: r.id }} confirm={`Restore ${r.label}?`}>
                      Restore
                    </ActionButton>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
