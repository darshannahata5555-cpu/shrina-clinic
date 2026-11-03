import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { PageHeader } from "@/components/ui/page";
import { RulesForm } from "./rules-form";

export const metadata = { title: "Payroll & attendance rules" };

export default async function PayrollRulesPage() {
  await requirePermission(["settings.manage", "payroll.manage"]);
  const [payroll, attendance, branches] = await Promise.all([
    getSetting("payroll"),
    getSetting("attendance"),
    db.branch.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
  ]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Payroll & attendance rules"
        description="The owner's salary, deduction, overtime, leave and check-in policy. Changes apply to draft payroll when it is recalculated."
        back={{ href: "/payroll", label: "Payroll" }}
      />
      <RulesForm v={{ ...payroll, ...attendance }} branchesWithoutGps={branches.filter((b) => !attendance.branchLocations[b.id]).map((b) => b.name)} />
    </div>
  );
}
