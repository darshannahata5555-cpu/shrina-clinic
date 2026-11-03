import Link from "next/link";
import { Lock } from "lucide-react";
import { db } from "@/lib/db";
import { can, type CurrentUser } from "@/lib/auth";
import { patientFinancials } from "@/lib/billing";
import { CONSENT_LABEL, type AccessiblePatient } from "@/lib/patients";
import { remainingSessions } from "@/lib/packages";
import { ageFrom, fmtDate, fmtDateTime, humanize, money, relativeDays } from "@/lib/format";
import { LEAD_SOURCES } from "@/lib/status";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";

export function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={done} aria-valuemax={total}>
      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  );
}

export async function OverviewTab({ patient: p, user }: { patient: AccessiblePatient; user: CurrentUser }) {
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 86400000);
  const [fin, packages, upcoming, consents, transfers, lastConsult, entries] = await Promise.all([
    can(user, "billing.view") ? patientFinancials(p.id) : Promise.resolve(null),
    db.treatmentPackage.findMany({
      where: { patientId: p.id, deletedAt: null, status: "ACTIVE" },
      include: { treatment: { select: { name: true } } },
      orderBy: { purchaseDate: "desc" },
    }),
    db.appointment.findMany({
      where: { patientId: p.id, deletedAt: null, startAt: { gte: now }, status: { in: ["BOOKED", "CONFIRMED", "CHECKED_IN", "IN_TREATMENT"] } },
      include: { treatment: { select: { name: true } }, doctor: { select: { fullName: true } }, therapist: { select: { fullName: true } }, branch: { select: { code: true } } },
      orderBy: { startAt: "asc" },
      take: 4,
    }),
    db.consentRecord.findMany({ where: { patientId: p.id }, orderBy: { signedAt: "desc" } }),
    db.patientTransfer.findMany({
      where: { patientId: p.id },
      include: { fromBranch: { select: { name: true } }, toBranch: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.consultation.findFirst({
      where: { patientId: p.id, deletedAt: null },
      orderBy: { consultationDate: "desc" },
      include: { doctor: { select: { fullName: true } } },
    }),
    can(user, "patients.medical") ? db.medicalHistoryEntry.count({ where: { patientId: p.id } }) : Promise.resolve(0),
  ]);
  const activeConsent = (t: string) => consents.find((c) => c.type === t && c.granted && !c.revokedAt);
  const age = ageFrom(p.dob);
  const medical = can(user, "patients.medical");

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <Card>
          <CardHeader title="Patient details" />
          <CardBody>
            <DetailList
              items={[
                ["Patient ID", <span key="c" className="font-medium">{p.code}</span>],
                ["Registered", fmtDate(p.registeredAt)],
                ["First visit", p.firstVisitAt ? fmtDate(p.firstVisitAt) : "Not yet visited"],
                ["Last visit", p.lastVisitAt ? `${fmtDate(p.lastVisitAt)} (${relativeDays(p.lastVisitAt)})` : "—"],
                ["Date of birth", p.dob ? `${fmtDate(p.dob)}${age !== null ? ` · ${age} years` : ""}` : "—"],
                ["Gender", p.gender ? humanize(p.gender) : "—"],
                ["Mobile", [p.mobile, p.altMobile].filter(Boolean).join(" / ")],
                ["Email", p.email ?? "—"],
                ["Address", [p.address, p.city].filter(Boolean).join(", ") || "—"],
                ["Source", p.source ? (LEAD_SOURCES.find(([k]) => k === p.source)?.[1] ?? humanize(p.source)) : "—"],
                ["Referred by", p.referredBy ?? "—"],
                ["Assigned doctor", p.assignedDoctor?.fullName ?? "Not assigned"],
                ["Branch", p.branch.name],
                ["Offers & updates", p.marketingConsent ? "Opted in" : "Not opted in"],
              ]}
            />
            {p.notes && (
              <div className="mt-4 rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink-2">
                <p className="mb-0.5 text-xs text-muted">Notes</p>
                {p.notes}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Skin & medical"
            description={medical ? "Confidential — visible to doctors and the owner only" : undefined}
            actions={medical && <LinkButton href={`/patients/${p.id}?tab=documents`} variant="ghost" size="sm">Medical records ({entries}) →</LinkButton>}
          />
          <CardBody>
            <DetailList
              items={[
                ["Skin type", p.skinType ?? "Not assessed"],
                ["Allergies", p.allergies ?? "None recorded"],
                [
                  "Medical history",
                  medical ? (
                    <span key="m" className="whitespace-pre-line">{p.medicalHistory ?? "None recorded"}</span>
                  ) : (
                    <span key="m" className="inline-flex items-center gap-1.5 text-muted">
                      <Lock className="h-3.5 w-3.5" /> Restricted to doctors
                    </span>
                  ),
                ],
                [
                  "Last consultation",
                  lastConsult ? (
                    <Link key="l" href={`/patients/${p.id}?tab=consultations`} className="hover:text-accent">
                      {fmtDate(lastConsult.consultationDate)} · {lastConsult.doctor.fullName}
                      {lastConsult.followUpDate && <span className="text-muted"> · follow-up {relativeDays(lastConsult.followUpDate)}</span>}
                    </Link>
                  ) : (
                    "—"
                  ),
                ],
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Active packages"
            description="Remaining = total − completed sessions"
            actions={<LinkButton href={`/patients/${p.id}?tab=packages`} variant="ghost" size="sm">All packages →</LinkButton>}
          />
          <CardBody>
            {packages.length === 0 ? (
              <p className="text-sm text-muted">No active packages.</p>
            ) : (
              <ul className="space-y-4">
                {packages.map((k) => (
                  <li key={k.id}>
                    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                      <Link href={`/treatments/packages/${k.id}`} className="text-sm font-medium text-ink hover:text-accent">
                        {k.name}
                      </Link>
                      <span className="tabular text-[13px] text-ink-2">
                        {k.completedSessions} of {k.totalSessions} done · <strong className="font-semibold text-ink">{remainingSessions(k)} left</strong>
                      </span>
                    </div>
                    <ProgressBar done={k.completedSessions} total={k.totalSessions} />
                    <p className="mt-1 text-xs text-muted">
                      {k.code} · bought {fmtDate(k.purchaseDate)}
                      {k.expiryDate && (
                        <span className={k.expiryDate < soon ? " text-warning" : ""}> · expires {fmtDate(k.expiryDate)}</span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="space-y-6">
        {fin && (
          <Card>
            <CardHeader title="Payments summary" actions={<LinkButton href={`/patients/${p.id}?tab=billing`} variant="ghost" size="sm">Billing →</LinkButton>} />
            <CardBody className="grid grid-cols-2 gap-2">
              {[
                ["Total billed", money(fin.billed, { decimals: false }), "text-ink"],
                ["Paid", money(fin.paid, { decimals: false }), "text-success"],
                ["Pending", money(fin.outstanding, { decimals: false }), fin.outstanding > 0 ? "text-warning" : "text-ink"],
                ["Advance balance", money(fin.advance, { decimals: false }), fin.advance > 0 ? "text-info" : "text-ink"],
              ].map(([l, v, c]) => (
                <div key={l} className="rounded-lg bg-surface-2 px-3 py-2.5">
                  <p className="text-[11px] text-muted">{l}</p>
                  <p className={`tabular mt-0.5 text-base font-semibold ${c}`}>{v}</p>
                </div>
              ))}
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader
            title="Upcoming appointments"
            actions={can(user, "appointments.manage") && <LinkButton href={`/appointments/new?patientId=${p.id}`} variant="ghost" size="sm">Book →</LinkButton>}
          />
          <CardBody>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted">No upcoming appointments.</p>
            ) : (
              <ul className="space-y-3">
                {upcoming.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/appointments/${a.id}`} className="text-sm font-medium text-ink hover:text-accent">
                        {fmtDateTime(a.startAt)}
                      </Link>
                      <p className="truncate text-xs text-muted">
                        {a.treatment?.name ?? "Consultation"} · {[a.doctor?.fullName, a.therapist?.fullName].filter(Boolean).join(", ") || "Unassigned"} · {a.branch.code}
                      </p>
                    </div>
                    <StatusBadge kind="appointment" status={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Consents" actions={<LinkButton href={`/patients/${p.id}?tab=documents`} variant="ghost" size="sm">Manage →</LinkButton>} />
          <CardBody>
            <ul className="space-y-2">
              {Object.entries(CONSENT_LABEL).map(([k, label]) => {
                const c = activeConsent(k);
                return (
                  <li key={k} className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="text-ink-2">{label}</span>
                    {c ? <Badge tone="success">Given {fmtDate(c.signedAt)}</Badge> : <Badge tone="neutral">Not recorded</Badge>}
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>

        {transfers.length > 0 && (
          <Card>
            <CardHeader title="Branch history" />
            <CardBody>
              <ul className="space-y-2.5 text-[13px]">
                {transfers.map((t) => (
                  <li key={t.id}>
                    <p className="text-ink">
                      {t.fromBranch.name} → {t.toBranch.name}
                    </p>
                    <p className="text-xs text-muted">
                      {fmtDate(t.createdAt)}
                      {t.reason ? ` · ${t.reason}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
