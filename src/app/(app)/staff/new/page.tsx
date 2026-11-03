import { requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { istDateKey } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { StaffForm } from "../staff-form";

export const metadata = { title: "Add employee" };

export default async function NewStaffPage() {
  await requirePermission("staff.manage");
  const scope = await getBranchScope();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Add employee" description="An employee ID is generated automatically." back={{ href: "/staff", label: "Staff" }} />
      <StaffForm
        branches={scope.branches.map((b) => ({ id: b.id, name: b.name }))}
        values={{ branchId: scope.defaultBranchId ?? undefined, joiningDate: istDateKey() }}
        canPay
      />
    </div>
  );
}
