import { requirePermission } from "@/lib/auth";
import { getAccessiblePatient } from "@/lib/patients";
import { clinicianOptions } from "@/lib/lookups";
import { toIstDateInput } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { PatientForm } from "../../patient-form";

export const metadata = { title: "Edit patient" };

export default async function EditPatientPage({ params }: PageProps<"/patients/[id]/edit">) {
  const { id } = await params;
  const user = await requirePermission("patients.edit");
  const { patient: p, scope } = await getAccessiblePatient(id);
  const { doctors } = await clinicianOptions(scope.branches.map((b) => b.id));
  const canMedical = user.permissions.has("patients.medical");
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`Edit ${p.fullName}`} description={`${p.code} · ${p.branch.name}`} back={{ href: `/patients/${p.id}`, label: "Back to profile" }} />
      <PatientForm
        doctors={doctors}
        branches={[]}
        canMedical={canMedical}
        cancelHref={`/patients/${p.id}`}
        values={{
          id: p.id,
          fullName: p.fullName,
          mobile: p.mobile,
          altMobile: p.altMobile,
          email: p.email,
          dob: toIstDateInput(p.dob),
          gender: p.gender,
          address: p.address,
          city: p.city,
          source: p.source,
          referredBy: p.referredBy,
          assignedDoctorId: p.assignedDoctorId,
          skinType: p.skinType,
          allergies: p.allergies,
          medicalHistory: canMedical ? p.medicalHistory : null,
          notes: p.notes,
          marketingConsent: p.marketingConsent,
          registeredAt: toIstDateInput(p.registeredAt),
        }}
      />
    </div>
  );
}
