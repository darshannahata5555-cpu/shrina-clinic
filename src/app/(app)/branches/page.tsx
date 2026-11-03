import { Building2, MapPin, Pencil, Phone, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { istMonthRange, money, toNum } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionButton } from "@/components/ui/form";
import { BranchForm } from "./branch-form";
import { toggleBranchAction } from "./actions";

export const metadata = { title: "Branch Management" };

export default async function BranchesPage() {
  const user = await requirePermission(["branches.manage", "branches.all"]);
  const canEdit = can(user, "branches.manage");
  const { start, end } = istMonthRange();
  const [branches, att] = await Promise.all([
    db.branch.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: { _count: { select: { patients: { where: { deletedAt: null } }, staff: { where: { deletedAt: null, status: "ACTIVE" } } } } },
    }),
    getSetting("attendance"),
  ]);
  const revenue = await db.payment.groupBy({
    by: ["branchId", "kind"],
    where: { paidAt: { gte: start, lt: end }, method: { not: "ADVANCE" } },
    _sum: { amount: true },
  });
  const revOf = (id: string) =>
    revenue.filter((r) => r.branchId === id).reduce((s, r) => s + (r.kind === "REFUND" ? -1 : 1) * toNum(r._sum.amount), 0);

  return (
    <>
      <PageHeader
        title="Branch Management"
        description="All SHRINA branches run from one system. Branch managers only see their own branch unless given extra access."
        actions={
          canEdit && (
            <Dialog title="Add branch" trigger={<Button><Plus className="h-4 w-4" /> Add branch</Button>}>
              <BranchForm />
            </Dialog>
          )
        }
      />
      <div className="grid gap-5 lg:grid-cols-2">
        {branches.map((b) => {
          const loc = att.branchLocations[b.id];
          return (
            <Card key={b.id} className={b.isActive ? "" : "opacity-70"}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-accent" /> {b.name}
                    <Badge tone="neutral">{b.code}</Badge>
                    {!b.isActive && <Badge tone="danger">Inactive</Badge>}
                  </span>
                }
                description={
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {b.city && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" /> {b.city}
                      </span>
                    )}
                    {b.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3.5 w-3.5" /> {b.phone}
                      </span>
                    )}
                  </span>
                }
                actions={
                  canEdit && (
                    <>
                      <Dialog title={`Edit ${b.name}`} trigger={<Button variant="outline" size="sm"><Pencil className="h-3.5 w-3.5" /> Edit</Button>}>
                        <BranchForm values={{ ...b, lat: loc?.lat ?? null, lng: loc?.lng ?? null }} />
                      </Dialog>
                      <ActionButton
                        action={toggleBranchAction}
                        fields={{ id: b.id }}
                        variant="ghost"
                        confirm={b.isActive ? `Deactivate ${b.name}? Staff will no longer be able to select it.` : undefined}
                      >
                        {b.isActive ? "Deactivate" : "Reactivate"}
                      </ActionButton>
                    </>
                  )
                }
              />
              <CardBody>
                <div className="mb-4 grid grid-cols-3 gap-2 text-center">
                  {[
                    ["Patients", b._count.patients],
                    ["Active staff", b._count.staff],
                    ["Revenue (month)", money(revOf(b.id), { decimals: false })],
                  ].map(([l, v]) => (
                    <div key={l as string} className="rounded-lg bg-surface-2 px-2 py-2.5">
                      <p className="tabular text-base font-semibold">{v}</p>
                      <p className="text-[11px] text-muted">{l}</p>
                    </div>
                  ))}
                </div>
                <DetailList
                  items={[
                    ["Hours", `${b.openTime} – ${b.closeTime}`],
                    ["GSTIN", b.gstin ?? "—"],
                    ["Email", b.email ?? "—"],
                    ["GPS check-in point", loc ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` : "Not set"],
                    ["Address", b.address ?? "—"],
                  ]}
                />
              </CardBody>
            </Card>
          );
        })}
      </div>
    </>
  );
}
