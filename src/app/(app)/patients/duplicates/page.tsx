import { CircleCheck } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { MergeForm, type DupPatient } from "./merge-form";

export const metadata = { title: "Duplicate patients" };

export default async function DuplicatesPage() {
  const user = await requirePermission("patients.edit");
  const scope = await getBranchScope();
  const accessible = scope.branches.map((b) => b.id);
  const canMerge = can(user, "patients.delete");

  // Mobile numbers shared by 2+ active patients, where at least one is in an accessible branch.
  const groups = await db.patient.groupBy({
    by: ["mobile"],
    where: { deletedAt: null },
    having: { mobile: { _count: { gt: 1 } } },
  });
  const patients = groups.length
    ? await db.patient.findMany({
        where: { deletedAt: null, mobile: { in: groups.map((g) => g.mobile) } },
        include: {
          branch: { select: { name: true } },
          _count: { select: { appointments: true, invoices: true, packages: true, consultations: true } },
        },
        orderBy: { registeredAt: "asc" },
      })
    : [];
  const byMobile = new Map<string, typeof patients>();
  for (const p of patients) byMobile.set(p.mobile, [...(byMobile.get(p.mobile) ?? []), p]);
  const visible = [...byMobile].filter(([, list]) => list.some((p) => accessible.includes(p.branchId)) && list.every((p) => accessible.includes(p.branchId)));
  const hidden = byMobile.size - visible.length;

  return (
    <>
      <PageHeader
        title="Possible duplicate patients"
        description="Patients sharing the same mobile number. Keep the main record and merge the rest — all history moves across."
        back={{ href: "/patients", label: "Patients" }}
      />
      {visible.length === 0 ? (
        <Card>
          <EmptyState icon={<CircleCheck className="h-5 w-5" />} title="No duplicates found" description="Every active patient has a unique mobile number." />
        </Card>
      ) : (
        <div className="space-y-5">
          {visible.map(([mobile, list]) => (
            <Card key={mobile}>
              <CardHeader
                title={`Mobile ${mobile}`}
                description={`${list.length} records · family members may legitimately share a phone — only merge if it is the same person`}
              />
              <MergeForm
                canMerge={canMerge}
                patients={list.map(
                  (p): DupPatient => ({
                    id: p.id,
                    code: p.code,
                    fullName: p.fullName,
                    branch: p.branch.name,
                    registered: fmtDate(p.registeredAt),
                    lastVisit: p.lastVisitAt ? fmtDate(p.lastVisitAt) : null,
                    email: p.email,
                    counts: p._count,
                  }),
                )}
              />
            </Card>
          ))}
        </div>
      )}
      {hidden > 0 && (
        <p className="mt-4 text-[13px] text-muted">
          {hidden} more group{hidden > 1 ? "s" : ""} include patients from branches you can&apos;t access — ask the owner to review.
        </p>
      )}
    </>
  );
}
