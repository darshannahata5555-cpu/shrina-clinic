import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { assertBranchAccess, getBranchScope } from "@/lib/branch";
import { db } from "@/lib/db";
import { istDateKey, istTimeKey } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { AppointmentForm } from "../../appointment-form";
import { appointmentFormData } from "../../_data";

export const metadata = { title: "Edit appointment" };

export default async function EditAppointmentPage({ params }: PageProps<"/appointments/[id]/edit">) {
  const user = await requirePermission("appointments.manage");
  const { id } = await params;
  const a = await db.appointment.findFirst({
    where: { id, deletedAt: null },
    include: { patient: { select: { id: true, code: true, fullName: true, mobile: true } }, package: { select: { name: true, code: true } } },
  });
  if (!a) notFound();
  try {
    await assertBranchAccess(user, a.branchId);
  } catch {
    redirect("/forbidden");
  }
  if (["COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULED"].includes(a.status)) redirect(`/appointments/${a.id}`);
  const scope = await getBranchScope();
  const data = await appointmentFormData(scope);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Edit appointment" description={a.patient.fullName} back={{ href: `/appointments/${a.id}`, label: "Back to appointment" }} />
      <Card>
        <CardBody className="py-5">
          <AppointmentForm
            {...data}
            values={{
              id: a.id,
              patient: a.patient,
              treatmentId: a.treatmentId,
              packageId: a.packageId,
              packageLabel: a.package ? `${a.package.name} (${a.package.code})` : null,
              doctorId: a.doctorId,
              therapistId: a.therapistId,
              branchId: a.branchId,
              date: istDateKey(a.startAt),
              time: istTimeKey(a.startAt),
              duration: Math.round((a.endAt.getTime() - a.startAt.getTime()) / 60000),
              source: a.source,
              notes: a.notes,
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
