import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarClock, CalendarPlus, CircleCheck, Pencil, Receipt, TriangleAlert, XCircle } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { assertBranchAccess } from "@/lib/branch";
import { staffOptions } from "@/lib/lookups";
import { NEXT_STATUS } from "@/lib/appointments";
import { remainingSessions } from "@/lib/packages";
import { fmtDate, fmtDateTime, fmtTime, fmtWeekday, humanize, istDateKey, istTimeKey, minutesToHours } from "@/lib/format";
import { LEAD_SOURCES } from "@/lib/status";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionButton } from "@/components/ui/form";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { setAppointmentStatusAction } from "../actions";
import { CancelAppointmentForm, CompleteAppointmentForm, RescheduleForm } from "../_components/appointment-dialogs";

export const metadata = { title: "Appointment" };

const STEP_LABEL: Record<string, string> = {
  CONFIRMED: "Confirm",
  CHECKED_IN: "Check in",
  IN_TREATMENT: "Start treatment",
  NO_SHOW: "No show",
  BOOKED: "Back to booked",
};

export default async function AppointmentPage({ params, searchParams }: PageProps<"/appointments/[id]">) {
  const user = await requirePermission("appointments.view");
  const { id } = await params;
  const sp = await searchParams;
  const a = await db.appointment.findFirst({
    where: { id, deletedAt: null },
    include: {
      patient: { select: { id: true, fullName: true, code: true, mobile: true, allergies: true, medicalHistory: true, skinType: true, dob: true } },
      treatment: { select: { id: true, name: true, category: true } },
      package: true,
      doctor: { select: { fullName: true } },
      therapist: { select: { fullName: true } },
      branch: { select: { id: true, name: true, code: true } },
      session: { select: { id: true, status: true, sessionNumber: true, notes: true, observations: true, performedAt: true } },
    },
  });
  if (!a) notFound();
  try {
    await assertBranchAccess(user, a.branchId);
  } catch {
    redirect("/forbidden");
  }

  const [rescheduledFrom, rescheduledTo, history, creator, clinicians] = await Promise.all([
    a.rescheduledFromId ? db.appointment.findUnique({ where: { id: a.rescheduledFromId }, select: { id: true, startAt: true } }) : null,
    db.appointment.findFirst({ where: { rescheduledFromId: a.id }, select: { id: true, startAt: true } }),
    db.appointment.findMany({
      where: { patientId: a.patientId, deletedAt: null, id: { not: a.id } },
      include: { treatment: { select: { name: true } } },
      orderBy: { startAt: "desc" },
      take: 6,
    }),
    a.createdById ? db.user.findUnique({ where: { id: a.createdById }, select: { name: true } }) : null,
    can(user, "appointments.manage") ? staffOptions([a.branchId], ["DOCTOR", "THERAPIST"]) : Promise.resolve([]),
  ]);

  const manage = can(user, "appointments.manage");
  const canComplete = can(user, "sessions.update");
  const open = ["BOOKED", "CONFIRMED", "CHECKED_IN", "IN_TREATMENT"].includes(a.status);
  const steps = (NEXT_STATUS[a.status] ?? []).filter((s) =>
    s === "CHECKED_IN" || s === "IN_TREATMENT" ? manage || canComplete : manage,
  );
  const minutes = Math.round((a.endAt.getTime() - a.startAt.getTime()) / 60000);
  const sourceLabel = LEAD_SOURCES.find(([k]) => k === a.source)?.[1] ?? humanize(a.source);
  const pkgSessionNo = a.package ? (a.session?.sessionNumber ?? a.package.completedSessions + 1) : null;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        back={{ href: `/appointments?date=${istDateKey(a.startAt)}`, label: "Calendar" }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {a.patient.fullName}
            <StatusBadge kind="appointment" status={a.status} />
          </span>
        }
        description={`${fmtWeekday(a.startAt)}, ${fmtDate(a.startAt)} · ${fmtTime(a.startAt)}–${fmtTime(a.endAt)} · ${a.branch.name}`}
        actions={
          <>
            {a.status === "COMPLETED" && can(user, "billing.create") && (
              <LinkButton href={`/billing/new?patientId=${a.patient.id}&appointmentId=${a.id}${a.packageId ? "" : ""}`} variant="primary">
                <Receipt className="h-4 w-4" /> Create invoice
              </LinkButton>
            )}
            <LinkButton href={`/patients/${a.patient.id}`} variant="outline">
              Patient profile
            </LinkButton>
          </>
        }
      />

      {sp.booked && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-success/25 bg-success-soft px-3.5 py-2.5 text-sm text-success">
          <CircleCheck className="h-4 w-4" /> Appointment booked{a.package ? " and the package session planned" : ""}.
        </div>
      )}
      {sp.rescheduled && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-info/25 bg-info-soft px-3.5 py-2.5 text-sm text-info">
          <CalendarClock className="h-4 w-4" /> Rescheduled — this is the new appointment. The old slot is kept in history.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {open && (manage || canComplete) && (
            <Card>
              <CardHeader title="Next step" description="Move the appointment along as the patient arrives and is treated." />
              <CardBody className="flex flex-wrap gap-2">
                {steps.map((s) => (
                  <ActionButton
                    key={s}
                    action={setAppointmentStatusAction}
                    fields={{ id: a.id, status: s }}
                    variant={s === "NO_SHOW" || s === "BOOKED" ? "ghost" : "outline"}
                    size="md"
                    confirm={s === "NO_SHOW" ? "Mark this patient as a no-show? A linked package session will be recorded as missed." : undefined}
                  >
                    {STEP_LABEL[s] ?? humanize(s)}
                  </ActionButton>
                ))}
                {canComplete && ["CHECKED_IN", "IN_TREATMENT", "CONFIRMED", "BOOKED"].includes(a.status) && (
                  <Dialog title="Complete appointment" description={`${a.patient.fullName} · ${a.treatment?.name ?? "Consultation"}`} trigger={<Button><CircleCheck className="h-4 w-4" /> Mark completed</Button>}>
                    <CompleteAppointmentForm id={a.id} hasPackage={!!a.packageId} />
                  </Dialog>
                )}
                {manage && (
                  <>
                    <Dialog
                      title="Reschedule appointment"
                      trigger={<Button variant="outline"><CalendarClock className="h-4 w-4" /> Reschedule</Button>}
                    >
                      <RescheduleForm
                        id={a.id}
                        date={istDateKey(a.startAt)}
                        time={istTimeKey(a.startAt)}
                        doctorId={a.doctorId}
                        therapistId={a.therapistId}
                        doctors={clinicians.filter((c) => c.staffType === "DOCTOR").map((c) => [c.id, c.fullName] as const)}
                        therapists={clinicians.filter((c) => c.staffType === "THERAPIST").map((c) => [c.id, c.fullName] as const)}
                      />
                    </Dialog>
                    {["BOOKED", "CONFIRMED", "CHECKED_IN"].includes(a.status) && (
                      <LinkButton href={`/appointments/${a.id}/edit`} variant="ghost">
                        <Pencil className="h-4 w-4" /> Edit
                      </LinkButton>
                    )}
                    <Dialog title="Cancel appointment" trigger={<Button variant="ghost" className="text-danger"><XCircle className="h-4 w-4" /> Cancel</Button>}>
                      <CancelAppointmentForm id={a.id} />
                    </Dialog>
                  </>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Appointment details" />
            <CardBody>
              <DetailList
                items={[
                  ["Treatment", a.treatment ? a.treatment.name : "Consultation"],
                  ["Duration", minutesToHours(minutes).replace(/^0h /, "")],
                  ["Doctor", a.doctor?.fullName ?? "—"],
                  ["Therapist", a.therapist?.fullName ?? "—"],
                  ["Branch", a.branch.name],
                  ["Booking source", sourceLabel],
                  [
                    "Package",
                    a.package ? (
                      <Link href={`/treatments/packages/${a.package.id}`} className="text-accent hover:underline">
                        {a.package.name} — session {pkgSessionNo} of {a.package.totalSessions} ({remainingSessions(a.package)} left)
                      </Link>
                    ) : (
                      "—"
                    ),
                  ],
                  ["Checked in", a.checkedInAt ? fmtTime(a.checkedInAt) : "—"],
                  ["Completed", a.completedAt ? fmtDateTime(a.completedAt) : "—"],
                  ["Booked by", `${creator?.name ?? "—"} · ${fmtDateTime(a.createdAt)}`],
                  ...(a.cancelReason ? ([[a.status === "RESCHEDULED" ? "Reschedule note" : "Cancellation reason", a.cancelReason]] as [string, string][]) : []),
                  ...(rescheduledFrom
                    ? ([["Rescheduled from", <Link key="f" href={`/appointments/${rescheduledFrom.id}`} className="text-accent hover:underline">{fmtDateTime(rescheduledFrom.startAt)}</Link>]] as [string, React.ReactNode][])
                    : []),
                  ...(rescheduledTo
                    ? ([["Moved to", <Link key="t" href={`/appointments/${rescheduledTo.id}`} className="text-accent hover:underline">{fmtDateTime(rescheduledTo.startAt)}</Link>]] as [string, React.ReactNode][])
                    : []),
                ]}
              />
              {a.notes && (
                <div className="mt-4 rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink-2">
                  <p className="mb-0.5 text-xs text-muted">Notes</p>
                  {a.notes}
                </div>
              )}
              {a.session && (a.session.notes || a.session.observations) && (
                <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink-2">
                  <p className="mb-0.5 text-xs text-muted">Session notes</p>
                  {[a.session.notes, a.session.observations].filter(Boolean).join(" · ")}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Patient" actions={<Badge tone="neutral">{a.patient.code}</Badge>} />
            <CardBody className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-muted">Mobile</p>
                <a href={`tel:${a.patient.mobile}`} className="text-ink hover:text-accent">{a.patient.mobile}</a>
              </div>
              {a.patient.skinType && (
                <div>
                  <p className="text-xs text-muted">Skin type</p>
                  <p>{a.patient.skinType}</p>
                </div>
              )}
              {a.patient.allergies && a.patient.allergies.toLowerCase() !== "none known" && (
                <div className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-danger">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <span className="block text-xs font-medium">Allergies</span>
                    {a.patient.allergies}
                  </span>
                </div>
              )}
              {can(user, "patients.medical") && a.patient.medicalHistory && (
                <div>
                  <p className="text-xs text-muted">Medical history (confidential)</p>
                  <p className="text-ink-2">{a.patient.medicalHistory}</p>
                </div>
              )}
              {manage && (
                <LinkButton href={`/appointments/new?patientId=${a.patient.id}${a.package && a.package.status === "ACTIVE" ? `&packageId=${a.package.id}` : ""}`} variant="soft" size="sm" className="w-full">
                  <CalendarPlus className="h-4 w-4" /> Book another visit
                </LinkButton>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Other visits" />
            {history.length === 0 ? (
              <CardBody>
                <p className="text-sm text-muted">No other appointments.</p>
              </CardBody>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Date</TH>
                    <TH>Status</TH>
                  </tr>
                </THead>
                <tbody>
                  {history.map((h) => (
                    <TR key={h.id}>
                      <TD>
                        <Link href={`/appointments/${h.id}`} className="hover:text-accent">
                          <span className="block text-[13px]">{fmtDate(h.startAt)}</span>
                          <span className="block text-xs text-muted">{h.treatment?.name ?? "Consultation"}</span>
                        </Link>
                      </TD>
                      <TD>
                        <StatusBadge kind="appointment" status={h.status} />
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
