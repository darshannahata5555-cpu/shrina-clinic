import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarPlus, CircleCheck, NotebookPen, Pencil, Receipt, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { assertBranchAccess } from "@/lib/branch";
import { staffOptions } from "@/lib/lookups";
import { remainingSessions } from "@/lib/packages";
import { fmtDate, fmtDateTime, fmtTime, money, relativeDays, toIstDateInput, toIstLocalInput, toNum } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, DetailList, EmptyState } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionButton } from "@/components/ui/form";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { approveSessionAction } from "../../../sessions/actions";
import { AdjustSessionForm, CompleteSessionForm, MarkSessionForm, SessionNotesForm, WalkInSessionForm } from "../../../sessions/session-dialogs";
import { Progress } from "../../_components/progress";
import { CancelPackageForm, EditPackageForm } from "./package-dialogs";

export const metadata = { title: "Treatment package" };

export default async function PackagePage({ params, searchParams }: PageProps<"/treatments/packages/[id]">) {
  const user = await requirePermission("packages.view");
  const { id } = await params;
  const sp = await searchParams;
  const pkg = await db.treatmentPackage.findFirst({
    where: { id, deletedAt: null },
    include: {
      patient: { select: { id: true, fullName: true, code: true, mobile: true } },
      treatment: { select: { id: true, name: true, category: true, durationMins: true } },
      branch: { select: { name: true, code: true } },
      doctor: { select: { fullName: true } },
      therapist: { select: { fullName: true } },
      renewedFrom: { select: { id: true, code: true, name: true } },
      renewals: { where: { deletedAt: null }, select: { id: true, code: true, name: true, status: true } },
      sessions: {
        include: {
          doctor: { select: { fullName: true } },
          therapist: { select: { fullName: true } },
          appointment: { select: { id: true, status: true } },
        },
        orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
      },
      invoiceItems: { include: { invoice: { select: { id: true, number: true, status: true, total: true, balance: true, deletedAt: true } } } },
    },
  });
  if (!pkg) notFound();
  try {
    await assertBranchAccess(user, pkg.branchId);
  } catch {
    redirect("/forbidden");
  }

  const approverIds = [...new Set(pkg.sessions.map((s) => s.approvedById).filter(Boolean))] as string[];
  const [clinicians, approvers] = await Promise.all([
    staffOptions([pkg.branchId], ["DOCTOR", "THERAPIST"]),
    approverIds.length ? db.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const doctors = clinicians.filter((c) => c.staffType === "DOCTOR").map((c) => [c.id, c.fullName] as const);
  const therapists = clinicians.filter((c) => c.staffType === "THERAPIST").map((c) => [c.id, c.fullName] as const);
  const approverName = new Map(approvers.map((a) => [a.id, a.name]));

  const canUpdate = can(user, "sessions.update");
  const canApprove = can(user, "sessions.approve");
  const canManage = can(user, "packages.manage");
  const remaining = remainingSessions(pkg);
  const planned = pkg.sessions.filter((s) => s.status === "SCHEDULED").length;
  const active = pkg.status === "ACTIVE";
  const nowLocal = toIstLocalInput(new Date());
  const invoices = pkg.invoiceItems.map((i) => i.invoice).filter((i) => !i.deletedAt && i.status !== "CANCELLED");
  const billed = invoices.length > 0;
  const expSoon = active && pkg.expiryDate && pkg.expiryDate.getTime() - Date.now() < 30 * 86400000;

  // Display order: done/missed/cancelled history first (by date), then planned.
  const sessions = [...pkg.sessions].sort((a, b) => {
    const ta = (a.performedAt ?? a.scheduledAt ?? a.createdAt).getTime();
    const tb = (b.performedAt ?? b.scheduledAt ?? b.createdAt).getTime();
    return ta - tb;
  });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        back={{ href: `/patients/${pkg.patient.id}?tab=packages`, label: pkg.patient.fullName }}
        title={pkg.name}
        meta={
          <>
            <StatusBadge kind="package" status={pkg.status} />
            <Badge tone="neutral">{pkg.code}</Badge>
            <span className="text-[13px] text-muted">
              <Link href={`/patients/${pkg.patient.id}`} className="hover:text-accent">
                {pkg.patient.fullName}
              </Link>{" "}
              · {pkg.branch.name}
            </span>
          </>
        }
        actions={
          <>
            {active && remaining > planned && can(user, "appointments.manage") && (
              <LinkButton href={`/appointments/new?patientId=${pkg.patient.id}&packageId=${pkg.id}`}>
                <CalendarPlus className="h-4 w-4" /> Schedule next session
              </LinkButton>
            )}
            {!billed && can(user, "billing.create") && pkg.status !== "CANCELLED" && (
              <LinkButton href={`/billing/new?patientId=${pkg.patient.id}&packageId=${pkg.id}`} variant="outline">
                <Receipt className="h-4 w-4" /> Bill this package
              </LinkButton>
            )}
          </>
        }
      />

      {sp.created && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/25 bg-success-soft px-3.5 py-2.5 text-sm text-success">
          <span className="flex items-center gap-2">
            <CircleCheck className="h-4 w-4" /> Package created. Next: bill it and book the first session.
          </span>
          <span className="flex gap-2">
            {can(user, "billing.create") && (
              <LinkButton href={`/billing/new?patientId=${pkg.patient.id}&packageId=${pkg.id}`} size="sm">
                Bill this package
              </LinkButton>
            )}
            {can(user, "appointments.manage") && (
              <LinkButton href={`/appointments/new?patientId=${pkg.patient.id}&packageId=${pkg.id}`} size="sm" variant="outline">
                Book first session
              </LinkButton>
            )}
          </span>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Total sessions", pkg.totalSessions, null],
          ["Completed", pkg.completedSessions, null],
          ["Remaining", remaining, planned ? `${planned} planned` : "None planned"],
          ["Expiry", fmtDate(pkg.expiryDate), pkg.expiryDate && active ? relativeDays(pkg.expiryDate) : null],
        ].map(([l, v, h]) => (
          <div key={l as string} className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <p className="text-[13px] font-medium text-muted">{l}</p>
            <p className={`tabular mt-1.5 text-[22px] font-semibold tracking-tight ${l === "Expiry" && expSoon ? "text-warning" : "text-ink"}`}>{v}</p>
            {h && <p className="mt-1 text-xs text-muted">{h}</p>}
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader
              title="Session history"
              description={<Progress done={pkg.completedSessions} total={pkg.totalSessions} wide className="mt-1.5 w-64 max-w-full" />}
              actions={
                active &&
                remaining > 0 &&
                canUpdate && (
                  <Dialog
                    title="Record a session done"
                    description="For a walk-in or a session done without an appointment."
                    trigger={<Button variant="outline" size="sm"><NotebookPen className="h-3.5 w-3.5" /> Record walk-in session</Button>}
                  >
                    <WalkInSessionForm packageId={pkg.id} doctorId={pkg.doctorId} therapistId={pkg.therapistId} doctors={doctors} therapists={therapists} nowLocal={nowLocal} />
                  </Dialog>
                )
              }
            />
            {sessions.length === 0 ? (
              <EmptyState title="No sessions yet" description="Schedule the first session to get started." />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>#</TH>
                    <TH>Date</TH>
                    <TH>Status</TH>
                    <TH className="hidden md:table-cell">Doctor / Therapist</TH>
                    <TH className="hidden sm:table-cell">Notes</TH>
                    <TH className="text-right">Actions</TH>
                  </tr>
                </THead>
                <tbody>
                  {sessions.map((s) => {
                    const when = s.performedAt ?? s.scheduledAt;
                    return (
                      <TR key={s.id}>
                        <TD className="tabular text-muted">{s.sessionNumber ?? "—"}</TD>
                        <TD className="whitespace-nowrap">
                          <span className="block text-[13px]">{when ? fmtDate(when) : "—"}</span>
                          <span className="text-xs text-muted">
                            {when ? fmtTime(when) : ""}
                            {s.appointment && (
                              <>
                                {" · "}
                                <Link href={`/appointments/${s.appointment.id}`} className="hover:text-accent">
                                  appointment
                                </Link>
                              </>
                            )}
                          </span>
                        </TD>
                        <TD>
                          <div className="flex flex-col items-start gap-1">
                            <StatusBadge kind="session" status={s.status} />
                            {s.status === "COMPLETED" &&
                              (s.approvedAt ? (
                                <span className="inline-flex items-center gap-1 text-[11px] text-success">
                                  <ShieldCheck className="h-3 w-3" /> {approverName.get(s.approvedById ?? "") ?? "Approved"}
                                </span>
                              ) : (
                                <span className="text-[11px] text-warning">Awaiting approval</span>
                              ))}
                          </div>
                        </TD>
                        <TD className="hidden text-[13px] text-ink-2 md:table-cell">{[s.doctor?.fullName, s.therapist?.fullName].filter(Boolean).join(" · ") || "—"}</TD>
                        <TD className="hidden max-w-xs text-[13px] text-ink-2 sm:table-cell">
                          <span className="line-clamp-2">{[s.notes, s.observations].filter(Boolean).join(" · ") || "—"}</span>
                          {s.adjustmentReason && <span className="mt-0.5 block text-xs text-warning">Adjustment: {s.adjustmentReason}</span>}
                        </TD>
                        <TD className="text-right">
                          <div className="inline-flex flex-wrap justify-end gap-1">
                            {s.status === "SCHEDULED" && canUpdate && (
                              <>
                                <Dialog title={`Session ${pkg.completedSessions + 1} of ${pkg.totalSessions} — mark done`} trigger={<Button size="sm">Done</Button>}>
                                  <CompleteSessionForm sessionId={s.id} doctorId={s.doctorId} therapistId={s.therapistId} doctors={doctors} therapists={therapists} nowLocal={nowLocal} />
                                </Dialog>
                                <Dialog title="Mark session missed" size="sm" trigger={<Button size="sm" variant="ghost">Missed</Button>}>
                                  <MarkSessionForm sessionId={s.id} status="MISSED" />
                                </Dialog>
                                <Dialog title="Cancel session" size="sm" trigger={<Button size="sm" variant="ghost">Cancel</Button>}>
                                  <MarkSessionForm sessionId={s.id} status="CANCELLED" />
                                </Dialog>
                              </>
                            )}
                            {s.status === "COMPLETED" && !s.approvedAt && canApprove && (
                              <ActionButton action={approveSessionAction} fields={{ sessionId: s.id }}>
                                Approve
                              </ActionButton>
                            )}
                            {canUpdate && s.status !== "RESCHEDULED" && (
                              <Dialog title="Session notes" trigger={<Button size="sm" variant="ghost" title="Edit notes"><Pencil className="h-3.5 w-3.5" /></Button>}>
                                <SessionNotesForm sessionId={s.id} notes={s.notes} observations={s.observations} />
                              </Dialog>
                            )}
                            {canApprove && s.status !== "SCHEDULED" && s.status !== "RESCHEDULED" && (
                              <Dialog title="Adjust session record" description="Corrections are recorded with your name and reason." size="sm" trigger={<Button size="sm" variant="ghost">Adjust</Button>}>
                                <AdjustSessionForm sessionId={s.id} current={s.status} />
                              </Dialog>
                            )}
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Package"
              actions={
                canManage && (
                  <Dialog title="Edit package" trigger={<Button variant="ghost" size="sm"><Pencil className="h-3.5 w-3.5" /> Edit</Button>}>
                    <EditPackageForm
                      values={{
                        id: pkg.id,
                        name: pkg.name,
                        bodyArea: pkg.bodyArea,
                        doctorId: pkg.doctorId,
                        therapistId: pkg.therapistId,
                        notes: pkg.notes,
                        expiryDate: toIstDateInput(pkg.expiryDate),
                        totalSessions: pkg.totalSessions,
                      }}
                      doctors={doctors}
                      therapists={therapists}
                      canAdjust={canApprove}
                      completed={pkg.completedSessions}
                    />
                  </Dialog>
                )
              }
            />
            <CardBody>
              <DetailList
                className="sm:grid-cols-1"
                items={[
                  ["Treatment", <Link key="t" href={`/treatments/catalog/${pkg.treatment.id}`} className="hover:text-accent">{pkg.treatment.name}</Link>],
                  ["Category", pkg.treatment.category],
                  ["Body area", pkg.bodyArea ?? "—"],
                  ["Package price", money(toNum(pkg.price))],
                  ["Purchased", fmtDate(pkg.purchaseDate)],
                  ["Doctor", pkg.doctor?.fullName ?? "—"],
                  ["Therapist", pkg.therapist?.fullName ?? "—"],
                  ...(pkg.renewedFrom ? ([["Renewed from", <Link key="r" href={`/treatments/packages/${pkg.renewedFrom.id}`} className="text-accent hover:underline">{pkg.renewedFrom.code}</Link>]] as [string, React.ReactNode][]) : []),
                  ...(pkg.renewals.length
                    ? ([["Renewed as", pkg.renewals.map((r) => <Link key={r.id} href={`/treatments/packages/${r.id}`} className="mr-2 text-accent hover:underline">{r.code}</Link>)]] as [string, React.ReactNode][])
                    : []),
                  ["Created", fmtDateTime(pkg.createdAt)],
                ]}
              />
              {pkg.notes && <p className="mt-4 whitespace-pre-line rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] text-ink-2">{pkg.notes}</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Billing" />
            <CardBody className="space-y-2 text-sm">
              {invoices.length === 0 ? (
                <p className="text-muted">Not billed yet.</p>
              ) : (
                invoices.map((i) => (
                  <Link key={i.id} href={`/billing/${i.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 hover:bg-surface-2">
                    <span>
                      <span className="block font-medium">{i.number}</span>
                      <span className="text-xs text-muted">
                        {money(toNum(i.total))}
                        {toNum(i.balance) > 0 ? ` · ${money(toNum(i.balance))} due` : ""}
                      </span>
                    </span>
                    <StatusBadge kind="invoice" status={i.status} />
                  </Link>
                ))
              )}
            </CardBody>
          </Card>

          {canManage && (
            <Card>
              <CardHeader title="Renew or cancel" />
              <CardBody className="flex flex-wrap gap-2">
                <LinkButton href={`/treatments/packages/new?renew=${pkg.id}`} variant="outline" size="sm">
                  <RefreshCw className="h-3.5 w-3.5" /> Renew package
                </LinkButton>
                {pkg.status !== "CANCELLED" && pkg.status !== "COMPLETED" && (
                  <Dialog title="Cancel package" size="sm" trigger={<Button variant="ghost" size="sm" className="text-danger"><XCircle className="h-3.5 w-3.5" /> Cancel package</Button>}>
                    <CancelPackageForm id={pkg.id} remaining={remaining} />
                  </Dialog>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
