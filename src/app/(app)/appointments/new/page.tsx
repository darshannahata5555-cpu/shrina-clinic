import { requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { pickedPatient } from "@/lib/lookups";
import { istDateKey } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { AppointmentForm } from "../appointment-form";
import { appointmentFormData } from "../_data";
import { patientPackagesAction } from "../actions";

export const metadata = { title: "Book appointment" };

export default async function NewAppointmentPage({ searchParams }: PageProps<"/appointments/new">) {
  await requirePermission("appointments.manage");
  const scope = await getBranchScope();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const patient = await pickedPatient(one("patientId"));
  const [data, packages] = await Promise.all([appointmentFormData(scope), patient ? patientPackagesAction(patient.id) : Promise.resolve([])]);
  const date = one("date") && /^\d{4}-\d{2}-\d{2}$/.test(one("date")!) ? one("date")! : istDateKey();
  const time = one("time") && /^\d{2}:\d{2}$/.test(one("time")!) ? one("time")! : "";
  const pkgId = one("packageId");
  const pkg = packages.find((p) => p.id === pkgId);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Book appointment" description="Doctors and therapists can't be double-booked — overlapping slots are blocked automatically." back={{ href: "/appointments", label: "Appointments" }} />
      <Card>
        <CardBody className="py-5">
          <AppointmentForm
            {...data}
            initialPackages={packages}
            values={{
              patient,
              packageId: pkg?.id ?? null,
              treatmentId: one("treatmentId") ?? null,
              doctorId: one("doctorId") ?? null,
              therapistId: one("therapistId") ?? null,
              branchId: scope.defaultBranchId,
              date,
              time,
              duration: 30,
              source: "PHONE",
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
