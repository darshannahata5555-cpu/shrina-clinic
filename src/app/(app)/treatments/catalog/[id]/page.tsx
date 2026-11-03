import { notFound } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { fmtNum, istMonthRange, money, toNum } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, DetailList, EmptyState, StatCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionButton } from "@/components/ui/form";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { TreatmentForm } from "../../treatment-form";
import { deleteTreatmentAction, removeUsageAction } from "../../actions";
import { UsageForm } from "./usage-form";

export const metadata = { title: "Treatment" };

export default async function TreatmentDetailPage({ params }: PageProps<"/treatments/catalog/[id]">) {
  const user = await requirePermission(["packages.view", "treatments.manage"]);
  const scope = await getBranchScope();
  const { id } = await params;
  const t = await db.treatment.findFirst({
    where: { id, deletedAt: null },
    include: { productUsages: { include: { product: { select: { id: true, name: true, unit: true, purchasePrice: true, sku: true } } }, orderBy: { product: { name: "asc" } } } },
  });
  if (!t) notFound();
  const canEdit = can(user, "treatments.manage");
  const { start, end } = istMonthRange();
  const [activePackages, monthSessions, products] = await Promise.all([
    db.treatmentPackage.count({ where: { treatmentId: id, status: "ACTIVE", deletedAt: null, branchId: { in: scope.ids } } }),
    db.treatmentSession.count({ where: { treatmentId: id, status: "COMPLETED", performedAt: { gte: start, lt: end }, branchId: { in: scope.ids } } }),
    canEdit ? db.product.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true, unit: true, category: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const costPerSession = t.productUsages.reduce((s, u) => s + toNum(u.quantity) * toNum(u.product.purchasePrice), 0);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        back={{ href: "/treatments?tab=catalog", label: "Treatment catalogue" }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {t.name} {!t.isActive && <Badge tone="neutral">Inactive</Badge>}
          </span>
        }
        description={t.category}
        actions={
          canEdit && (
            <>
              <Dialog title={`Edit ${t.name}`} size="lg" trigger={<Button variant="outline"><Pencil className="h-4 w-4" /> Edit</Button>}>
                <TreatmentForm
                  values={{
                    id: t.id,
                    name: t.name,
                    category: t.category,
                    description: t.description,
                    defaultPrice: toNum(t.defaultPrice),
                    defaultSessions: t.defaultSessions,
                    sessionGapDays: t.sessionGapDays,
                    durationMins: t.durationMins,
                    gstRate: toNum(t.gstRate),
                    validityDays: t.validityDays,
                    isActive: t.isActive,
                  }}
                />
              </Dialog>
              <ActionButton action={deleteTreatmentAction} fields={{ id: t.id }} variant="ghost" size="md" confirm={`Delete ${t.name}? It can be restored from the Recycle bin.`}>
                <Trash2 className="h-4 w-4" /> Delete
              </ActionButton>
            </>
          )
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Price per session" value={money(toNum(t.defaultPrice), { decimals: false })} hint={`+ ${toNum(t.gstRate)}% GST`} />
        <StatCard label="Usual course" value={`${t.defaultSessions} session${t.defaultSessions > 1 ? "s" : ""}`} hint={t.defaultSessions > 1 ? `every ${t.sessionGapDays} days` : `${t.durationMins} min`} />
        <StatCard label="Active packages" value={fmtNum(activePackages)} hint={scope.current?.name ?? "All branches"} />
        <StatCard label="Sessions this month" value={fmtNum(monthSessions)} hint="Completed" />
      </div>
      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="Details" />
          <CardBody>
            <DetailList
              items={[
                ["Duration", `${t.durationMins} minutes`],
                ["Package validity", `${t.validityDays} days from purchase`],
                ["Gap between sessions", `${t.sessionGapDays} days`],
                ["GST", `${toNum(t.gstRate)}%`],
                ["Description", t.description ?? "—"],
              ]}
              className="sm:grid-cols-1"
            />
          </CardBody>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader
            title="Products used per session"
            description="Deducted from the branch's stock automatically every time a session is marked done."
            actions={costPerSession > 0 && <Badge tone="info">Cost ≈ {money(costPerSession)} / session</Badge>}
          />
          {t.productUsages.length === 0 ? (
            <EmptyState title="No products linked" description="Add products like serums, tips or gels so stock is deducted automatically." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Product</TH>
                  <TH className="text-right">Per session</TH>
                  <TH className="hidden text-right sm:table-cell">Cost</TH>
                  {canEdit && <TH />}
                </tr>
              </THead>
              <tbody>
                {t.productUsages.map((u) => (
                  <TR key={u.id}>
                    <TD>
                      <span className="block">{u.product.name}</span>
                      <span className="text-xs text-muted">{u.product.sku}</span>
                    </TD>
                    <TD className="tabular text-right">
                      {fmtNum(toNum(u.quantity))} {u.product.unit}
                    </TD>
                    <TD className="tabular hidden text-right text-ink-2 sm:table-cell">{money(toNum(u.quantity) * toNum(u.product.purchasePrice))}</TD>
                    {canEdit && (
                      <TD className="text-right">
                        <ActionButton action={removeUsageAction} fields={{ id: u.id }} variant="ghost" confirm={`Stop deducting ${u.product.name} for ${t.name}?`}>
                          Remove
                        </ActionButton>
                      </TD>
                    )}
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
          {canEdit && (
            <CardBody className="border-t border-border">
              <UsageForm treatmentId={t.id} products={products} />
            </CardBody>
          )}
        </Card>
      </div>
    </div>
  );
}
