import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { db } from "@/lib/db";
import { toIstDateInput, toNum } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { StaffForm } from "../../staff-form";

export const metadata = { title: "Edit employee" };

export default async function EditStaffPage({ params }: PageProps<"/staff/[id]/edit">) {
  await requirePermission("staff.manage");
  const { id } = await params;
  const scope = await getBranchScope();
  const s = await db.staff.findFirst({ where: { id, deletedAt: null, branchId: { in: scope.branches.map((b) => b.id) } } });
  if (!s) notFound();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`Edit ${s.fullName}`} description={`${s.code} · ${s.designation}`} back={{ href: `/staff/${s.id}`, label: s.fullName }} />
      <StaffForm
        branches={scope.branches.map((b) => ({ id: b.id, name: b.name }))}
        canPay
        values={{ ...s, monthlySalary: toNum(s.monthlySalary), joiningDate: toIstDateInput(s.joiningDate) }}
      />
    </div>
  );
}
