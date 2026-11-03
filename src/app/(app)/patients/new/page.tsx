import { requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { clinicianOptions } from "@/lib/lookups";
import { istDateKey } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { PatientForm } from "../patient-form";

export const metadata = { title: "Register patient" };

export default async function NewPatientPage() {
  const user = await requirePermission("patients.create");
  const scope = await getBranchScope();
  const { doctors } = await clinicianOptions(scope.branches.map((b) => b.id));
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Register patient" description="Search first to avoid duplicates — the mobile number is checked automatically." back={{ href: "/patients", label: "Patients" }} />
      <PatientForm
        doctors={doctors}
        branches={scope.branches.map((b) => ({ id: b.id, name: b.name }))}
        canMedical={user.permissions.has("patients.medical")}
        cancelHref="/patients"
        values={{ branchId: scope.defaultBranchId, registeredAt: istDateKey() }}
      />
    </div>
  );
}
