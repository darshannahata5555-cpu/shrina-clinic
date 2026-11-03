import { requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { PageHeader } from "@/components/ui/page";
import { ImportClient } from "./import-client";

export const metadata = { title: "Import patients" };

export default async function ImportPatientsPage() {
  await requirePermission("patients.import");
  const scope = await getBranchScope();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Import patients from Excel"
        description="Migrate existing patient records. Each row is validated and checked against existing mobile numbers before anything is saved."
        back={{ href: "/patients", label: "Patients" }}
      />
      <ImportClient branches={scope.branches.map((b) => ({ id: b.id, name: b.name }))} defaultBranchId={scope.defaultBranchId} />
    </div>
  );
}
