import { Lock, Pencil, Stethoscope } from "lucide-react";
import { db } from "@/lib/db";
import { can, type CurrentUser } from "@/lib/auth";
import type { BranchScope } from "@/lib/branch";
import type { AccessiblePatient } from "@/lib/patients";
import { clinicianOptions } from "@/lib/lookups";
import { fmtDate, fmtDateTime, relativeDays, toIstDateInput, toIstLocalInput } from "@/lib/format";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionButton } from "@/components/ui/form";
import { ConsultationForm } from "../consultation-form";
import { deleteConsultationAction } from "../actions";

export async function ConsultationsTab({ patient: p, user, scope }: { patient: AccessiblePatient; user: CurrentUser; scope: BranchScope }) {
  const medical = can(user, "patients.medical");
  const canCreate = can(user, "consultations.create");
  const [consultations, { doctors }] = await Promise.all([
    db.consultation.findMany({
      where: { patientId: p.id, deletedAt: null },
      include: { doctor: { select: { id: true, fullName: true } }, branch: { select: { code: true, name: true } } },
      orderBy: { consultationDate: "desc" },
    }),
    clinicianOptions(scope.branches.map((b) => b.id)),
  ]);
  const myDoctorId = user.staff?.staffType === "DOCTOR" ? user.staff.id : (p.assignedDoctorId ?? "");
  const writeBranch = scope.current?.id ?? p.branchId;
  const nowLocal = toIstLocalInput(new Date());

  const row = (label: string, value: string | null) =>
    value ? (
      <div>
        <dt className="text-xs text-muted">{label}</dt>
        <dd className="mt-0.5 whitespace-pre-line text-sm text-ink">{value}</dd>
      </div>
    ) : null;

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-2">
        {consultations.length
          ? `${consultations.length} previous consultation${consultations.length === 1 ? "" : "s"} — review them before recommending a new treatment.`
          : "No consultations recorded yet."}
        {!medical && (
          <span className="ml-1 inline-flex items-center gap-1 text-muted">
            <Lock className="h-3.5 w-3.5" /> Doctor&apos;s confidential notes are hidden for your role.
          </span>
        )}
      </p>

      {consultations.length === 0 && !canCreate && (
        <Card>
          <EmptyState icon={<Stethoscope className="h-5 w-5" />} title="No consultations yet" />
        </Card>
      )}

      {consultations.map((c) => {
        const canEdit = canCreate && (c.createdById === user.id || c.doctorId === user.staff?.id || can(user, "users.manage"));
        return (
          <Card key={c.id} id={`c-${c.id}`}>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <Stethoscope className="h-4 w-4 text-accent" /> {fmtDateTime(c.consultationDate)}
                </span>
              }
              description={`${c.doctor.fullName} · ${c.branch.name}`}
              actions={
                <>
                  {c.followUpDate && (
                    <Badge tone={c.followUpDate < new Date() ? "danger" : "violet"}>
                      Follow-up {fmtDate(c.followUpDate)} ({relativeDays(c.followUpDate)})
                    </Badge>
                  )}
                  {canEdit && (
                    <Dialog
                      size="lg"
                      title="Edit consultation"
                      trigger={
                        <Button variant="ghost" size="sm">
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                      }
                    >
                      <ConsultationForm
                        patientId={p.id}
                        branchId={c.branchId}
                        doctors={doctors}
                        canMedical={medical}
                        values={{
                          id: c.id,
                          doctorId: c.doctorId,
                          consultationDate: toIstLocalInput(c.consultationDate),
                          complaint: c.complaint,
                          medicalHistory: medical ? c.medicalHistory : null,
                          skinAssessment: c.skinAssessment,
                          skinType: c.skinType,
                          treatmentRecommended: c.treatmentRecommended,
                          treatmentPerformed: c.treatmentPerformed,
                          productsRecommended: c.productsRecommended,
                          homeCare: c.homeCare,
                          doctorNotes: medical ? c.doctorNotes : null,
                          followUpDate: toIstDateInput(c.followUpDate),
                        }}
                      />
                    </Dialog>
                  )}
                  {canEdit && (c.createdById === user.id || can(user, "users.manage")) && (
                    <ActionButton action={deleteConsultationAction} fields={{ id: c.id }} variant="ghost" className="text-danger" confirm="Delete this consultation record?">
                      Delete
                    </ActionButton>
                  )}
                </>
              }
            />
            <CardBody>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {row("Complaint", c.complaint)}
                {row("Skin assessment", [c.skinType && `Skin type: ${c.skinType}`, c.skinAssessment].filter(Boolean).join(" — ") || null)}
                {row("Treatment recommended", c.treatmentRecommended)}
                {row("Treatment performed", c.treatmentPerformed)}
                {row("Products recommended", c.productsRecommended)}
                {row("Home-care instructions", c.homeCare)}
              </dl>
              {medical && (c.medicalHistory || c.doctorNotes) && (
                <div className="mt-4 rounded-lg border border-border bg-surface-2 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
                    <Lock className="h-3.5 w-3.5" /> Confidential
                  </p>
                  <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    {row("Medical history", c.medicalHistory)}
                    {row("Doctor's notes", c.doctorNotes)}
                  </dl>
                </div>
              )}
            </CardBody>
          </Card>
        );
      })}

      {canCreate && (
        <Card id="new-consultation">
          <CardHeader title="Record new consultation" description={`${p.fullName} · ${p.code}`} />
          <CardBody>
            <ConsultationForm
              patientId={p.id}
              branchId={writeBranch}
              doctors={doctors}
              canMedical={medical}
              values={{ doctorId: myDoctorId, consultationDate: nowLocal, skinType: p.skinType }}
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
