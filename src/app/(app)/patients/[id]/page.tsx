import { CalendarDays, Mail, MapPin, Pencil, Phone, Receipt, Sparkles, TriangleAlert, ArrowRightLeft, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getAccessiblePatient } from "@/lib/patients";
import { ageFrom, humanize, initials } from "@/lib/format";
import { LEAD_SOURCES } from "@/lib/status";
import { LinkTabs } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionButton } from "@/components/ui/form";
import { deletePatientAction } from "../actions";
import { TransferForm } from "./transfer-form";
import { OverviewTab } from "./tabs/overview";
import { HistoryTab } from "./tabs/history";
import { PackagesTab } from "./tabs/packages";
import { ConsultationsTab } from "./tabs/consultations";
import { PhotosTab } from "./tabs/photos";
import { BillingTab } from "./tabs/billing";
import { DocumentsTab } from "./tabs/documents";

export async function generateMetadata({ params }: PageProps<"/patients/[id]">) {
  const { id } = await params;
  const p = await db.patient.findUnique({ where: { id }, select: { fullName: true } });
  return { title: p?.fullName ?? "Patient" };
}

export default async function PatientProfilePage({ params, searchParams }: PageProps<"/patients/[id]">) {
  const user = await requirePermission("patients.view");
  const { id } = await params;
  const sp = await searchParams;
  const { patient: p, scope } = await getAccessiblePatient(id);

  const [pkgCount, consultCount, photoCount] = await Promise.all([
    db.treatmentPackage.count({ where: { patientId: id, deletedAt: null } }),
    db.consultation.count({ where: { patientId: id, deletedAt: null } }),
    can(user, "photos.view") ? db.patientPhoto.count({ where: { patientId: id, deletedAt: null } }) : Promise.resolve(0),
  ]);

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "history", label: "Treatment history" },
    { key: "packages", label: "Packages & sessions", count: pkgCount },
    { key: "consultations", label: "Consultations", count: consultCount },
    ...(can(user, "photos.view") ? [{ key: "photos", label: "Photos", count: photoCount }] : []),
    ...(can(user, "billing.view") ? [{ key: "billing", label: "Billing" }] : []),
    { key: "documents", label: "Consents & records" },
  ];
  const tabParam = typeof sp.tab === "string" ? sp.tab : "overview";
  const tab = tabs.some((t) => t.key === tabParam) ? tabParam : "overview";
  const age = ageFrom(p.dob);
  const otherBranches = scope.user.allBranches
    ? (await db.branch.findMany({ where: { isActive: true, id: { not: p.branchId } }, select: { id: true, name: true } }))
    : scope.branches.filter((b) => b.id !== p.branchId).map((b) => ({ id: b.id, name: b.name }));

  return (
    <>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-accent-soft text-lg font-semibold text-accent">{initials(p.fullName)}</span>
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight text-ink sm:text-2xl">{p.fullName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
              <Badge tone="accent">{p.code}</Badge>
              <Badge tone="neutral">{p.branch.name}</Badge>
              {(age !== null || p.gender) && <span>{[age !== null ? `${age} yrs` : null, p.gender ? humanize(p.gender) : null].filter(Boolean).join(" · ")}</span>}
              {p.source && <span>· via {LEAD_SOURCES.find(([k]) => k === p.source)?.[1] ?? humanize(p.source)}</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
              <a href={`tel:${p.mobile}`} className="inline-flex items-center gap-1.5 hover:text-accent">
                <Phone className="h-3.5 w-3.5 text-muted" /> {p.mobile}
              </a>
              {p.email && (
                <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1.5 hover:text-accent">
                  <Mail className="h-3.5 w-3.5 text-muted" /> {p.email}
                </a>
              )}
              {p.city && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-muted" /> {p.city}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can(user, "appointments.manage") && (
            <LinkButton href={`/appointments/new?patientId=${p.id}`} variant="outline" size="sm">
              <CalendarDays className="h-3.5 w-3.5" /> Book
            </LinkButton>
          )}
          {can(user, "packages.manage") && (
            <LinkButton href={`/treatments/packages/new?patientId=${p.id}`} variant="outline" size="sm">
              <Sparkles className="h-3.5 w-3.5" /> Sell package
            </LinkButton>
          )}
          {can(user, "billing.create") && (
            <>
              <LinkButton href={`/payments/new?patientId=${p.id}`} variant="outline" size="sm">
                <Wallet className="h-3.5 w-3.5" /> Payment
              </LinkButton>
              <LinkButton href={`/billing/new?patientId=${p.id}`} size="sm">
                <Receipt className="h-3.5 w-3.5" /> New invoice
              </LinkButton>
            </>
          )}
          {can(user, "patients.edit") && (
            <LinkButton href={`/patients/${p.id}/edit`} variant="ghost" size="sm">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </LinkButton>
          )}
          {can(user, "patients.transfer") && otherBranches.length > 0 && (
            <Dialog
              title="Transfer patient to another branch"
              description="The patient's full history stays attached. Future visits default to the new branch."
              trigger={
                <Button variant="ghost" size="sm">
                  <ArrowRightLeft className="h-3.5 w-3.5" /> Transfer
                </Button>
              }
            >
              <TransferForm patientId={p.id} currentBranch={p.branch.name} branches={otherBranches} />
            </Dialog>
          )}
          {can(user, "patients.delete") && (
            <ActionButton
              action={deletePatientAction}
              fields={{ id: p.id }}
              variant="ghost"
              className="text-danger"
              confirm={`Archive ${p.fullName}? The record will be hidden but can be restored from the recycle bin.`}
            >
              Archive
            </ActionButton>
          )}
        </div>
      </div>

      {p.allergies && !/^(none|nil|no|na|n\/a)(\s+known)?$/i.test(p.allergies.trim()) && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong className="font-semibold">Allergy alert:</strong> {p.allergies}
          </span>
        </div>
      )}

      <LinkTabs active={tab} tabs={tabs.map((t) => ({ ...t, href: t.key === "overview" ? `/patients/${p.id}` : `/patients/${p.id}?tab=${t.key}` }))} />

      {tab === "overview" && <OverviewTab patient={p} user={user} />}
      {tab === "history" && <HistoryTab patient={p} user={user} sp={sp} />}
      {tab === "packages" && <PackagesTab patientId={p.id} user={user} />}
      {tab === "consultations" && <ConsultationsTab patient={p} user={user} scope={scope} />}
      {tab === "photos" && <PhotosTab patientId={p.id} user={user} sp={sp} />}
      {tab === "billing" && <BillingTab patientId={p.id} user={user} />}
      {tab === "documents" && <DocumentsTab patientId={p.id} user={user} />}
    </>
  );
}
