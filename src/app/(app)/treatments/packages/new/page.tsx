import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { assertBranchAccess, getBranchScope } from "@/lib/branch";
import { db } from "@/lib/db";
import { pickedPatient } from "@/lib/lookups";
import { istDateKey, toNum } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { PackageForm } from "../package-form";
import { packageFormData } from "../_data";

export const metadata = { title: "Sell package" };

export default async function NewPackagePage({ searchParams }: PageProps<"/treatments/packages/new">) {
  const user = await requirePermission("packages.manage");
  const scope = await getBranchScope();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const renewId = one("renew");
  const renew = renewId ? await db.treatmentPackage.findFirst({ where: { id: renewId, deletedAt: null } }) : null;
  if (renewId && !renew) notFound();
  if (renew) await assertBranchAccess(user, renew.branchId);
  const patient = await pickedPatient(renew?.patientId ?? one("patientId"));
  const data = await packageFormData(scope);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={renew ? "Renew package" : "Sell treatment package"}
        description={renew ? `Renewing ${renew.name} (${renew.code}). The new package is linked to the old one for renewal tracking.` : "Remaining sessions are calculated automatically as sessions are completed."}
        back={renew ? { href: `/treatments/packages/${renew.id}`, label: "Back to package" } : patient ? { href: `/patients/${patient.id}?tab=packages`, label: patient.fullName } : { href: "/treatments", label: "Treatments" }}
      />
      <Card>
        <CardBody className="py-5">
          <PackageForm
            {...data}
            patient={patient}
            lockPatient={!!renew}
            today={istDateKey()}
            defaults={
              renew
                ? {
                    treatmentId: renew.treatmentId,
                    totalSessions: renew.totalSessions,
                    price: toNum(renew.price),
                    bodyArea: renew.bodyArea,
                    doctorId: renew.doctorId,
                    therapistId: renew.therapistId,
                    branchId: renew.branchId,
                    renewedFromId: renew.id,
                  }
                : { treatmentId: one("treatmentId"), branchId: scope.defaultBranchId }
            }
          />
        </CardBody>
      </Card>
    </div>
  );
}
